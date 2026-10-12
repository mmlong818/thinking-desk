import Anthropic from '@anthropic-ai/sdk';
import type { AiProvider, CompleteResult } from '../types';
import { schemaInstruction } from '../json-schema';
import { validateBaseUrl } from './validate-base-url';

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured');
  const baseURL = validateBaseUrl('claude', process.env.ANTHROPIC_BASE_URL) ?? undefined;
  return new Anthropic({ apiKey, baseURL });
}

// Static fallback list — Anthropic does expose a models endpoint, but we keep a
// curated short list so the UI surfaces only models we've validated for the
// nine-node prompts. 4.6 is the newest generation that still accepts the
// non-default `temperature` we send; Sonnet 5.x / Opus 4.7+ reject it with a 400.
const CLAUDE_FALLBACK = [
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
];

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
    const client = getClient();
    const systemMessages = req.messages.filter((m) => m.role === 'system');
    const turns = req.messages.filter((m) => m.role !== 'system');
    const started = Date.now();

    const systemText = [
      ...systemMessages.map((m) => m.content),
      req.schema ? schemaInstruction(req.schema) : null,
    ]
      .filter(Boolean)
      .join('\n\n');

    const res = await client.messages.create(
      {
        model,
        system: systemText || undefined,
        messages: turns.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
        max_tokens: req.maxTokens ?? 4096,
        temperature: req.temperature ?? 0.3,
      },
      { signal: req.signal },
    );

    const text = res.content
      .filter((b) => b.type === 'text')
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('');

    return {
      text,
      provider: 'claude',
      model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: res.usage.input_tokens,
        outputTokens: res.usage.output_tokens,
      },
      finishReason: res.stop_reason === 'max_tokens' ? 'length' : 'stop',
    };
  },
};
