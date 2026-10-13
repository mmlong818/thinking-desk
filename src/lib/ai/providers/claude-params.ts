import { adaptSchema, CLAUDE_DIALECT } from '../json-schema';
import { REASONING_HEADROOM_TOKENS } from './budget';
import type { CompleteRequest, JsonSchema } from '../types';

// Which request parameters each Claude model family accepts. Facts come from the bundled
// claude-api skill (2026-09-25 cache):
//   SKILL.md § Thinking & Effort (Quick Reference) — sampling, thinking default, effort levels
//   shared/tool-use-concepts.md § Structured Outputs — models supporting output_config.format
//   shared/model-migration.md § Migrating to Claude Sonnet 5.5 / Opus 5.5 — effort starting points
// We never send `thinking`: omitting it is accepted by every model (adaptive on 5.x / Fable /
// Mythos, off on 4.x), while `{ type: 'disabled' }` is a 400 on Sonnet 5.5 and Opus 5.5.

export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface ClaudeFamily {
  /** A non-default `temperature` is accepted (false: 400 on these models). */
  readonly sampling: boolean;
  /** `output_config.format` (structured outputs) is supported. */
  readonly structuredOutput: boolean;
  /** `output_config.effort` levels accepted; empty = never send effort. */
  readonly efforts: readonly ClaudeEffort[];
  /** Effort sent when the task asks for none. */
  readonly defaultEffort?: ClaudeEffort;
  /** Thinks when `thinking` is omitted; thinking tokens count toward max_tokens. */
  readonly thinksByDefault: boolean;
}

const ALL_EFFORTS: readonly ClaudeEffort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const EFFORTS_4_6: readonly ClaudeEffort[] = ['low', 'medium', 'high', 'max'];

const ALWAYS_THINKING = { sampling: false, structuredOutput: true, efforts: ALL_EFFORTS, thinksByDefault: true } as const;
const SAMPLING_4X = { sampling: true, structuredOutput: false, efforts: [], thinksByDefault: false } as const;

/** Keyed by alias; a key also matches its dated snapshot (`<alias>-YYYYMMDD`). */
export const CLAUDE_FAMILIES: Readonly<Record<string, ClaudeFamily>> = {
  'claude-fable-5-1': { ...ALWAYS_THINKING, defaultEffort: 'medium' },
  'claude-fable-5': { ...ALWAYS_THINKING, defaultEffort: 'medium' },
  'claude-mythos-5-1': { ...ALWAYS_THINKING, defaultEffort: 'medium' },
  'claude-mythos-5': { ...ALWAYS_THINKING, defaultEffort: 'medium' },
  // Opus 5.5: API default effort is medium; "start at medium" (model-migration.md).
  'claude-opus-5-5': { ...ALWAYS_THINKING, defaultEffort: 'medium' },
  'claude-opus-5': { ...ALWAYS_THINKING, defaultEffort: 'medium' },
  // Sonnet 5.5: "low for chat, content generation, classification, extraction" (model-migration.md).
  'claude-sonnet-5-5': { ...ALWAYS_THINKING, defaultEffort: 'low' },
  'claude-sonnet-5': { ...ALWAYS_THINKING, defaultEffort: 'low' },
  'claude-opus-4-8': { sampling: false, structuredOutput: true, efforts: ALL_EFFORTS, thinksByDefault: false },
  'claude-opus-4-7': { sampling: false, structuredOutput: false, efforts: ALL_EFFORTS, thinksByDefault: false },
  'claude-opus-4-6': { ...SAMPLING_4X, efforts: EFFORTS_4_6 },
  'claude-sonnet-4-6': { ...SAMPLING_4X, efforts: EFFORTS_4_6 },
  'claude-opus-4-5': { ...SAMPLING_4X, structuredOutput: true, efforts: ['low', 'medium', 'high'] },
  'claude-haiku-4-5': { ...SAMPLING_4X, structuredOutput: true },
  'claude-sonnet-4-5': SAMPLING_4X,
  'claude-sonnet-4-0': SAMPLING_4X,
  'claude-opus-4-0': SAMPLING_4X,
  'claude-sonnet-4': SAMPLING_4X,
  'claude-opus-4': SAMPLING_4X,
};

/**
 * Unknown ids (new or proxied models) get the request every model accepts: no sampling, no
 * effort, no output_config, no thinking headroom (a small-output model would 400 on it).
 */
export const UNKNOWN_CLAUDE_FAMILY: ClaudeFamily = {
  sampling: false, structuredOutput: false, efforts: [], thinksByDefault: false,
};

/** Strips platform prefixes / suffixes: `us.anthropic.claude-x@2025…`, `…-v1:0`. */
function normalize(model: string): string {
  return model.toLowerCase().replace(/^(?:[a-z]+\.)?anthropic\./, '').replace(/@.*$/, '').replace(/-v\d+(?::\d+)?$/, '');
}

export function claudeFamily(model: string): ClaudeFamily {
  const id = normalize(model);
  if (CLAUDE_FAMILIES[id]) return CLAUDE_FAMILIES[id];
  const dated = id.match(/^(.*)-\d{8}$/);
  return (dated && CLAUDE_FAMILIES[dated[1]]) || UNKNOWN_CLAUDE_FAMILY;
}

const MAX_TOKENS_CAP = 64_000;
const DEFAULT_VISIBLE_TOKENS = 4096;
const DEFAULT_TEMPERATURE = 0.3;

export interface ClaudeRequestParams {
  maxTokens: number;
  temperature?: number;
  effort?: ClaudeEffort;
  /** JSON Schema for output_config.format, when the model and the schema allow it. */
  outputSchema?: JsonSchema;
  /** True when the schema must instead be described in the system prompt. */
  schemaInPrompt: boolean;
}

type ParamInput = Pick<CompleteRequest, 'schema' | 'temperature' | 'effort' | 'maxTokens'>;

export function claudeRequestParams(model: string, req: ParamInput): ClaudeRequestParams {
  const f = claudeFamily(model);
  const visible = req.maxTokens ?? DEFAULT_VISIBLE_TOKENS;
  const effort = req.effort && f.efforts.includes(req.effort) ? req.effort : f.defaultEffort;
  const outputSchema = req.schema && f.structuredOutput ? adaptSchema(req.schema, CLAUDE_DIALECT) ?? undefined : undefined;
  return {
    maxTokens: f.thinksByDefault ? Math.min(visible + REASONING_HEADROOM_TOKENS, MAX_TOKENS_CAP) : visible,
    ...(f.sampling ? { temperature: req.temperature ?? DEFAULT_TEMPERATURE } : {}),
    ...(effort ? { effort } : {}),
    ...(outputSchema ? { outputSchema } : {}),
    schemaInPrompt: !!req.schema && !outputSchema,
  };
}
