export type AiProviderName = 'claude' | 'openai' | 'gemini' | 'zhipu';

export type AiTask =
  | 'BRIEF_CLARIFY'
  | 'BRIEF_EXTRACT'
  | 'BRIEF_PROBE'
  | 'USERS_JTBD'
  | 'USERS_PROBE'
  | 'STAKE_MATRIX'
  | 'STAKE_MATRIX'
  | 'ALT_SCAN'
  | 'SCEN_FEED'
  | 'SCEN_PAIN'
  | 'FEAT_DRAFT'
  | 'FEAT_THREE_Q'
  | 'LEAP_FIRST_PRINCIPLES'
  | 'LEAP_ANALOGY'
  | 'LEAP_CONSTRAINT_FLIP'
  | 'DESIGN_PROPOSAL'
  | 'SPLIT_SUBFEATURES'
  | 'VALUE_PROP'
  | 'RISK_AUDIT'
  | 'EXPORT_DOC'
  | 'HISTORY_SEARCH'
  | 'CONSISTENCY_CHECK'
  | 'FREE_ASK'
  | 'FOLLOW_UPS';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface CompleteRequest {
  task: AiTask;
  messages: ChatMessage[];
  /** JSON Schema the response must conform to (provider enforces via structured output when possible). */
  schema?: Record<string, unknown>;
  /** Enable provider-side web search when supported (Gemini grounding / Zhipu web_search). */
  webSearch?: boolean;
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface CompleteResult {
  /** Parsed structured output if `schema` was provided, else raw text. */
  data: unknown;
  text: string;
  provider: AiProviderName;
  model: string;
  latencyMs: number;
  usage?: { inputTokens?: number; outputTokens?: number };
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
}
