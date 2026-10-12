// Output budgets for reasoning models. Task `maxTokens` values size the *visible* answer (they
// were tuned on non-thinking models), but each vendor counts reasoning toward the same cap:
//   OpenAI  max_completion_tokens — "including visible output tokens and reasoning tokens"
//           (openai-openapi spec, CreateChatCompletionRequest)
//   Gemini  maxOutputTokens — "encompasses both thinking and response tokens" (ai.google.dev API ref)
//   Claude  max_tokens — thinking counts toward it (claude-api skill, Opus 5.5 / Sonnet 5.5 migration)
// 16k of headroom covers default/medium-effort reasoning on the largest prompts here (design and
// feature lists, ~16k visible) while keeping the total far under every family's output limit
// (128k GPT-6 / Claude 5.x, 64k Gemini 3.x); a cap is billed only for tokens actually produced.

export const REASONING_HEADROOM_TOKENS = 16_000;

/** Visible budget when a task sets none (was 4096: too tight once reasoning shares the cap). */
export const DEFAULT_VISIBLE_TOKENS = 8192;

export function withReasoningHeadroom(visible: number | undefined, cap: number): number {
  return Math.min((visible ?? DEFAULT_VISIBLE_TOKENS) + REASONING_HEADROOM_TOKENS, cap);
}
