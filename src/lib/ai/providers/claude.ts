import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, CompleteRequest, CompleteResult, FinishReason } from '../types';
import { schemaInstruction } from '../json-schema';
import { claudeRequestParams } from './claude-params';
import { validateBaseUrl } from './validate-base-url';

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const baseURL = validateBaseUrl('claude', process.env.ANTHROPIC_BASE_URL) ?? undefined;
  return new Anthropic({ apiKey, baseURL });
}

// Static fallback when the models endpoint is unreachable. Request parameters are chosen per
// model family (claude-params.ts), so any listed model can be driven; these are the defaults.
const CLAUDE_FALLBACK = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', fallback: true },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', fallback: true },
];

/** The Messages API body for one call: only the parameters this model family accepts. */
export function buildClaudeRequest(model: string, req: CompleteRequest): Anthropic.MessageCreateParamsNonStreaming {
  const p = claudeRequestParams(model, req);
  const system = [
    ...req.messages.filter((m) => m.role === 'system').map((m) => m.content),
    p.schemaInPrompt && req.schema ? schemaInstruction(req.schema) : null,
  ].filter(Boolean).join('\n\n');
  const outputConfig: Anthropic.OutputConfig = {
    ...(p.effort ? { effort: p.effort } : {}),
    ...(p.outputSchema ? { format: { type: 'json_schema', schema: p.outputSchema } } : {}),
  };
  return {
    model,
    max_tokens: p.maxTokens,
    ...(system ? { system } : {}),
    messages: req.messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ...(p.temperature !== undefined ? { temperature: p.temperature } : {}),
    ...(Object.keys(outputConfig).length > 0 ? { output_config: outputConfig } : {}),
  };
}

function finishReason(stop: Anthropic.StopReason | null): FinishReason {
  if (stop === 'max_tokens' || stop === 'model_context_window_exceeded') return 'length';
  if (stop === 'refusal') return 'refusal';
  return stop === 'end_turn' || stop === 'stop_sequence' ? 'stop' : 'other';
}

export const claudeProvider: AiProvider = {
  name: 'claude',
  isConfigured: () => !!process.env.ANTHROPIC_API_KEY,
  async listModels() {
    if (!process.env.ANTHROPIC_API_KEY) return [];
    try {
      const base = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com';
      const res = await fetch(`${base}/v1/models`, {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
      });
      if (!res.ok) return CLAUDE_FALLBACK;
      const json = (await res.json()) as { data?: { id: string; display_name?: string }[] };
      return (json.data ?? []).map((m) => ({ id: m.id, label: m.display_name ?? m.id }));
    } catch {
      return CLAUDE_FALLBACK;
    }
  },
  async complete(model, req): Promise<CompleteResult> {
    const started = Date.now();
    // A per-request timeout also lifts the SDK's non-streaming guard for large max_tokens.
    const res = await getClient().messages.create(buildClaudeRequest(model, req), requestOptions(req));
    return claudeResult(res, model, started);
  },

  /**
   * messages.stream() (claude-api skill, typescript/claude-api/streaming.md): `text` events carry
   * the deltas; finalMessage() resolves with the full Message (or rejects on error / abort).
   * output_config.format is a plain JSON schema here, so the SDK does not parse the answer.
   */
  async stream(model, req, onDelta): Promise<CompleteResult> {
    const started = Date.now();
    const stream = getClient().messages.stream(buildClaudeRequest(model, req), requestOptions(req));
    stream.on('text', (delta) => onDelta(delta));
    return claudeResult(await stream.finalMessage(), model, started);
  },
};

function requestOptions(req: CompleteRequest): Anthropic.RequestOptions {
  return { signal: req.signal, ...(req.timeoutMs ? { timeout: req.timeoutMs } : {}) };
}

function claudeResult(res: Anthropic.Message, model: string, started: number): CompleteResult {
  return {
    // Read blocks by type: adaptive thinking can put `thinking` blocks first.
    text: res.content.map((b) => (b.type === 'text' ? b.text : '')).join(''),
    provider: 'claude',
    model,
    latencyMs: Date.now() - started,
    usage: { inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens },
    finishReason: finishReason(res.stop_reason),
  };
}
