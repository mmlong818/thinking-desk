import type { NodeKind } from '../../data/nodes';
import type { ProjectRepository } from '../api/project-api';
import type { AdaptedOutput } from '../model/adapters/common';
import type { SaveRunResult } from '../model/repository';
import { RunMetaSchema, toRunInput, type RunMetaRecord } from '../model/run-meta';
import type { ItemRef } from '../model/types';

// One AI action as the UI performs it: POST the /api/ai route, turn the task output into item
// drafts with the task's adapter, and record the run (with its output) in the repository. A
// failed AI call is recorded too (status failed, nothing else changes). Pure: fetch and the
// repository are injected, so this runs in tests without a browser.

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface AiActionSpec<T> {
  /** e.g. '/api/ai/analyze-users' */
  route: string;
  body: Record<string, unknown>;
  /** Node the run belongs to (revise-features writes to `final` from the leap page). */
  node: NodeKind;
  /** Items the prompt was built from (Run.inputs). */
  inputs: ItemRef[];
  /** Task output → drafts; omitted for process steps (clarify / probe / follow-ups) that only record the run. */
  adapt?: (data: T) => AdaptedOutput;
}

export interface AiActionDeps {
  fetch: FetchLike;
  repo: ProjectRepository;
  projectId: string;
  signal?: AbortSignal;
}

export type AiActionOutcome<T> =
  | { ok: true; data: T; result: SaveRunResult }
  | { ok: false; aborted: boolean; message: string };

const CODE_MESSAGE: Record<string, string> = {
  timeout: 'AI 响应超时，请稍后重试',
  config: 'AI 模型配置有误，请检查模型选择或 .env',
  invalid_output: 'AI 输出格式不合规（已自动重试一次）',
  truncated: 'AI 输出超出长度上限被截断',
  refused: 'AI 拒绝回答（安全策略）',
  provider: 'AI 服务调用失败',
};

interface RouteAnswer {
  ok?: boolean;
  data?: unknown;
  run?: unknown;
  error?: string;
  detail?: string;
  code?: string;
}

function parseRun(raw: unknown): RunMetaRecord | null {
  const r = RunMetaSchema.safeParse(raw);
  return r.success ? r.data : null;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : (e as { name?: string })?.name === 'AbortError';
}

async function post(deps: AiActionDeps, spec: AiActionSpec<unknown>): Promise<{ res: Response; json: RouteAnswer }> {
  const res = await deps.fetch(spec.route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(spec.body),
    signal: deps.signal,
  });
  return { res, json: (await res.json().catch(() => ({}))) as RouteAnswer };
}

/** Production answers strip the run's error text; the error code still says what went wrong. */
async function recordFailure(deps: AiActionDeps, spec: AiActionSpec<unknown>, run: RunMetaRecord | null, json: RouteAnswer) {
  if (!run) return;
  const error = run.error ?? ([json.code, json.error].filter(Boolean).join(': ') || undefined);
  try {
    await deps.repo.saveRunOutput(deps.projectId, {
      run: toRunInput({ ...run, ...(error ? { error } : {}) }, { node: spec.node, inputs: spec.inputs }), drafts: [], replace: [],
    });
  } catch {
    // Recording the failure is best effort; the error the person sees is the AI one.
  }
}

function failureMessage(json: RouteAnswer, status: number): string {
  return json.detail ?? (json.code ? CODE_MESSAGE[json.code] : undefined) ?? json.error ?? `HTTP ${status}`;
}

export async function runAiAction<T>(deps: AiActionDeps, spec: AiActionSpec<T>): Promise<AiActionOutcome<T>> {
  const s = spec as AiActionSpec<unknown>;
  let answer: { res: Response; json: RouteAnswer };
  try {
    answer = await post(deps, s);
  } catch (e) {
    if (isAbort(e)) return { ok: false, aborted: true, message: '已取消' };
    return { ok: false, aborted: false, message: e instanceof Error ? e.message : String(e) };
  }
  const { res, json } = answer;
  const run = parseRun(json.run);
  if (!res.ok || !json.ok || json.data === undefined || !run) {
    await recordFailure(deps, s, run, json);
    return { ok: false, aborted: false, message: failureMessage(json, res.status) };
  }
  const data = json.data as T;
  const adapted = spec.adapt ? spec.adapt(data) : { drafts: [], replace: [] };
  const result = await deps.repo.saveRunOutput(deps.projectId, {
    run: toRunInput(run, { node: spec.node, inputs: spec.inputs }), ...adapted,
  });
  if (result.run.status === 'failed') {
    return { ok: false, aborted: false, message: `AI 输出没有可用条目（${result.run.error ?? '未知原因'}），原有内容未改动` };
  }
  return { ok: true, data, result };
}
