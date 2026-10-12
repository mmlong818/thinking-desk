import { createHash } from 'node:crypto';
import type { z } from 'zod';
import type { RunStatus, Usage } from '../model/types';
import { Deadline, DeadlineError } from './deadline';
import { parseJsonLoose } from './json';
import { taskJsonSchema } from './json-schema';
import { DATA_GUARD } from './prompt';
import { resolveProvider } from './router';
import type {
  AiProvider, AiTask, ChatMessage, CompleteRequest, CompleteResult, Effort, JsonSchema,
} from './types';

// The single entry point for AI calls: builds the JSON Schema from the task's Zod schema,
// validates the answer (one retry with the validation errors fed back), enforces a deadline
// and returns run metadata shaped for the `Run` record of src/lib/model.

export const DEFAULT_TIMEOUT_MS = 240_000;
const MAX_ATTEMPTS = 2;
const MAX_ISSUES_FED_BACK = 20;

/** Per-call options a route passes through. */
export interface TaskOptions {
  /** 'provider' or 'provider:model' override (validated by the router). */
  model?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface RunTaskSpec {
  task: AiTask;
  /** The prompt template; hashed (with the schema) into promptVersion. */
  system: string;
  /** Conversation after the system prompt; request data belongs in dataBlock()s. */
  messages: ChatMessage[];
  schema?: z.ZodType;
  maxTokens?: number;
  temperature?: number;
  effort?: Effort;
  webSearch?: boolean;
  options?: TaskOptions;
}

export interface RunMeta {
  task: AiTask;
  provider: string;
  model: string;
  promptVersion: string;
  status: RunStatus;
  attempts: number;
  latencyMs: number;
  usage?: Usage;
  error?: string;
}

export interface RunTaskResult<T> {
  data: T;
  text: string;
  run: RunMeta;
}

export type RunTaskErrorCode =
  | 'config' | 'provider' | 'invalid_output' | 'truncated' | 'refused' | 'timeout' | 'aborted';

export class RunTaskError extends Error {
  constructor(
    readonly code: RunTaskErrorCode,
    message: string,
    readonly run: RunMeta,
    readonly issues: string[] = [],
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'RunTaskError';
  }
}

export interface ResolvedTarget {
  provider: AiProvider;
  model: string;
}

export interface RunTaskDeps {
  resolve(task: AiTask, override?: string): Promise<ResolvedTarget>;
  now(): number;
}

const DEFAULT_DEPS: RunTaskDeps = { resolve: resolveProvider, now: () => Date.now() };

/** Stable hash of the prompt template + output schema. */
export function promptVersionOf(system: string, schema?: JsonSchema): string {
  const digest = createHash('sha256').update(`${system}\n${JSON.stringify(schema ?? null)}`).digest('hex');
  return `sha256:${digest.slice(0, 16)}`;
}

/** Client-safe mapping onto a Run record (the browser saves runs after each route call). */
export { toRunInput } from '../model/run-meta';

export async function runTask<S extends z.ZodType>(
  spec: RunTaskSpec & { schema: S }, deps?: RunTaskDeps,
): Promise<RunTaskResult<z.output<S>>>;
export async function runTask(spec: RunTaskSpec & { schema?: undefined }, deps?: RunTaskDeps): Promise<RunTaskResult<string>>;
export async function runTask(spec: RunTaskSpec, deps: RunTaskDeps = DEFAULT_DEPS): Promise<RunTaskResult<unknown>> {
  const started = deps.now();
  const schema = spec.schema ? taskJsonSchema(spec.schema) : undefined;
  const system = `${spec.system}\n\n${DATA_GUARD}`;
  const meta: RunMeta = {
    task: spec.task, provider: '', model: '', promptVersion: promptVersionOf(system, schema),
    status: 'failed', attempts: 0, latencyMs: 0,
  };
  const deadline = new Deadline(spec.options?.timeoutMs ?? DEFAULT_TIMEOUT_MS, spec.options?.signal);
  try {
    const target = await resolveTarget(spec, deps, deadline, meta);
    assertStructuredCapable(spec, target, meta);
    return await attempt(spec, { system, schema }, target, deadline, meta);
  } catch (e) {
    throw failure(e, meta);
  } finally {
    meta.latencyMs = Math.max(0, Math.round(deps.now() - started));
    deadline.dispose();
  }
}

async function resolveTarget(spec: RunTaskSpec, deps: RunTaskDeps, deadline: Deadline, meta: RunMeta) {
  try {
    const target = await deadline.race(deps.resolve(spec.task, spec.options?.model));
    meta.provider = target.provider.name;
    meta.model = target.model;
    return target;
  } catch (e) {
    if (e instanceof DeadlineError) throw e;
    throw new RunTaskError('config', e instanceof Error ? e.message : String(e), meta, [], { cause: e });
  }
}

/** A model the adapter cannot drive with a schema (e.g. GLM-5.3: thinking cannot be disabled) fails fast, unpaid. */
function assertStructuredCapable(spec: RunTaskSpec, target: ResolvedTarget, meta: RunMeta): void {
  if (!spec.schema || target.provider.canDrive?.(target.model) !== false) return;
  throw new RunTaskError(
    'config',
    `${target.provider.name}:${target.model} cannot run structured (JSON) tasks; pick another model`,
    meta,
  );
}

interface Prepared {
  system: string;
  schema?: JsonSchema;
}

async function attempt(
  spec: RunTaskSpec, p: Prepared, target: ResolvedTarget, deadline: Deadline, meta: RunMeta,
): Promise<RunTaskResult<unknown>> {
  let messages: ChatMessage[] = [{ role: 'system', content: p.system }, ...spec.messages];
  for (let n = 1; ; n++) {
    const req = request(spec, p.schema, messages, deadline);
    const res = await deadline.race(target.provider.complete(target.model, req));
    meta.attempts = n;
    meta.usage = addUsage(meta.usage, res.usage);
    const outcome = check(spec.schema, res);
    if (outcome.ok) {
      meta.status = n === 1 ? 'ok' : 'retried';
      return { data: outcome.data, text: res.text, run: meta };
    }
    if (outcome.code !== 'invalid_output' || n >= MAX_ATTEMPTS) {
      throw new RunTaskError(outcome.code, outcome.message, meta, outcome.issues);
    }
    messages = [...messages, { role: 'assistant', content: res.text || '（空输出）' }, { role: 'user', content: retryPrompt(outcome.issues) }];
  }
}

function request(spec: RunTaskSpec, schema: JsonSchema | undefined, messages: ChatMessage[], deadline: Deadline): CompleteRequest {
  return {
    task: spec.task, messages, schema, webSearch: spec.webSearch, maxTokens: spec.maxTokens,
    temperature: spec.temperature, effort: spec.effort, signal: deadline.signal, timeoutMs: deadline.remaining(),
  };
}

type Outcome =
  | { ok: true; data: unknown }
  | { ok: false; code: 'invalid_output' | 'truncated' | 'refused'; message: string; issues: string[] };

function check(schema: z.ZodType | undefined, res: CompleteResult): Outcome {
  if (res.finishReason === 'refusal') {
    return { ok: false, code: 'refused', message: `${res.provider} declined to answer (safety stop)`, issues: [] };
  }
  if (!schema) return { ok: true, data: res.text };
  const issues = validate(schema, res.text);
  if (issues.ok) return { ok: true, data: issues.data };
  if (res.finishReason === 'length') {
    return { ok: false, code: 'truncated', message: 'output hit the token limit before the JSON was complete', issues: issues.issues };
  }
  return { ok: false, code: 'invalid_output', message: `output failed validation: ${issues.issues.slice(0, 3).join('; ')}`, issues: issues.issues };
}

function validate(schema: z.ZodType, text: string): { ok: true; data: unknown } | { ok: false; issues: string[] } {
  let json: unknown;
  try {
    json = parseJsonLoose(text);
  } catch (e) {
    return { ok: false, issues: [`(root): 输出不是合法 JSON（${e instanceof Error ? e.message : String(e)}）`] };
  }
  const parsed = schema.safeParse(json);
  if (parsed.success) return { ok: true, data: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
}

function retryPrompt(issues: string[]): string {
  const list = issues.slice(0, MAX_ISSUES_FED_BACK).map((i) => `- ${i}`).join('\n');
  return `你上一次的输出没有通过校验，问题如下：\n${list}\n\n请修正这些问题，重新输出完整的 JSON（只输出 JSON，不要解释）。`;
}

function addUsage(total: Usage | undefined, u: CompleteResult['usage']): Usage | undefined {
  if (!u || (u.inputTokens === undefined && u.outputTokens === undefined)) return total;
  return {
    inputTokens: (total?.inputTokens ?? 0) + (u.inputTokens ?? 0),
    outputTokens: (total?.outputTokens ?? 0) + (u.outputTokens ?? 0),
  };
}

function failure(e: unknown, meta: RunMeta): RunTaskError {
  meta.status = 'failed';
  const err = e instanceof RunTaskError ? e
    : e instanceof DeadlineError ? new RunTaskError(e.reason, e.message, meta, [], { cause: e })
      : new RunTaskError('provider', e instanceof Error ? e.message : String(e), meta, [], { cause: e });
  meta.error = `${err.code}: ${err.message}`;
  return err;
}
