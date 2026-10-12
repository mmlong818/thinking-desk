export type AiProviderName = 'claude' | 'openai' | 'gemini' | 'zhipu';

export type AiTask =
  | 'BRIEF_CLARIFY'
  | 'BRIEF_EXTRACT'
  | 'BRIEF_PROBE'
  | 'USERS_JTBD'
  | 'STAKE_MATRIX'
  | 'ALT_SCAN'
  | 'SCEN_FEED'
  | 'SCEN_PAIN'
  | 'FEAT_DRAFT'
  | 'LEAP_FIRST_PRINCIPLES'
  | 'LEAP_ANALOGY'
  | 'LEAP_CONSTRAINT_FLIP'
  | 'DESIGN_PROPOSAL'
  | 'SPLIT_SUBFEATURES'
  | 'FREE_ASK'
  | 'FOLLOW_UPS';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Provider-neutral reasoning-effort hint; a provider maps it only where its API documents it. */
export type Effort = 'low' | 'medium' | 'high';

/** A JSON Schema document (see src/lib/ai/json-schema.ts for how it is produced and adapted). */
export type JsonSchema = Record<string, unknown>;

export interface CompleteRequest {
  task: AiTask;
  messages: ChatMessage[];
  /**
   * Canonical JSON Schema of the expected output (taskJsonSchema). Providers use their native
   * structured-output mechanism when the schema fits it, else embed it in the prompt.
   */
  schema?: JsonSchema;
  /** Enable provider-side web search when supported (Gemini grounding / Zhipu web_search). */
  webSearch?: boolean;
  /** Budget for the visible answer; providers add headroom for thinking / reasoning tokens. */
  maxTokens?: number;
  temperature?: number;
  effort?: Effort;
  signal?: AbortSignal;
  /** Milliseconds left before the caller's deadline (used as the SDK request timeout). */
  timeoutMs?: number;
}

/** Why generation stopped: `length` = hit the token cap, `refusal` = provider safety stop. */
export type FinishReason = 'stop' | 'length' | 'refusal' | 'other';

export interface CompleteResult {
  /** Raw answer text. runTask() parses and validates it; providers never parse. */
  text: string;
  provider: AiProviderName;
  model: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
  finishReason?: FinishReason;
}

export interface ModelInfo {
  /** Provider-specific model id used in API calls. */
  id: string;
  /** Human-readable display name. */
  label?: string;
  /** Optional capabilities hints for routing. */
  capabilities?: {
    webSearch?: boolean;
    longContext?: boolean;
    jsonMode?: boolean;
  };
}

export interface AiProvider {
  readonly name: AiProviderName;
  /** Returns true if the env is configured enough to call the provider. */
  isConfigured(): boolean;
  /** Discover models from the provider at runtime. Cached by the router. */
  listModels(): Promise<ModelInfo[]>;
  complete(model: string, req: CompleteRequest): Promise<CompleteResult>;
  /** False for a listed model this adapter's request params would make fail (auto-pick skips it). */
  canDrive?(modelId: string): boolean;
}
