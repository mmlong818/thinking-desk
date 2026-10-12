import type { AiProvider, CompleteResult, FinishReason } from '../types';
import { schemaInstruction } from '../json-schema';
import { validateBaseUrl } from './validate-base-url';

const OPENAI_FALLBACK = [
  { id: 'gpt-6.1-sol', label: 'GPT-6.1 Sol' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna' },
  { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
];

function getBase(): string {
  return validateBaseUrl('openai', process.env.OPENAI_BASE_URL) || 'https://api.openai.com/v1';
}

function getKey(): string {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error('OPENAI_API_KEY not configured');
  return k;
}

interface ChatChoice {
  message?: { content?: string | null };
  finish_reason?: string | null;
}
interface ChatResponse {
  choices?: ChatChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export const openaiProvider: AiProvider = {
  name: 'openai',
  isConfigured: () => !!process.env.OPENAI_API_KEY,

  async listModels() {
    if (!process.env.OPENAI_API_KEY) return [];
    try {
      const res = await fetch(`${getBase()}/models`, {
        headers: { authorization: `Bearer ${getKey()}` },
      });
      if (!res.ok) return OPENAI_FALLBACK;
      const json = (await res.json()) as { data?: { id: string }[] };
      const all = (json.data ?? []).map((m) => m.id);
      // Keep only chat-completion-capable model families.
      const chat = all.filter((id) => /^(gpt|chatgpt|o\d|o-)/i.test(id) && !/embedding|whisper|tts|dall|image|moderation|audio|realtime|search|transcribe/i.test(id));
      const list = chat.length > 0 ? chat : all;
      return list.map((id) => ({ id, label: id }));
    } catch {
      return OPENAI_FALLBACK;
    }
  },

  async complete(model, req): Promise<CompleteResult> {
    const started = Date.now();
    const systemMessages = req.messages.filter((m) => m.role === 'system').map((m) => m.content);
    if (req.schema) systemMessages.push(schemaInstruction(req.schema));
    const messages = [
      ...systemMessages.map((c) => ({ role: 'system' as const, content: c })),
      ...req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    ];

    // GPT-5+ / GPT-6 / o-series only accept `max_completion_tokens` and reject
    // `temperature`. Older 4.x families still use `max_tokens`.
    const isNewFamily = /^(gpt-[5-9]|o\d|o-)/i.test(model);
    const body: Record<string, unknown> = { model, messages };
    if (isNewFamily) {
      body.max_completion_tokens = req.maxTokens ?? 4096;
    } else {
      body.max_tokens = req.maxTokens ?? 4096;
      body.temperature = req.temperature ?? 0.3;
    }
    if (req.schema) body.response_format = { type: 'json_object' };

    const res = await fetch(`${getBase()}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${getKey()}`,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
    }
    const json = (await res.json()) as ChatResponse;
    const choice = json.choices?.[0];

    return {
      text: choice?.message?.content ?? '',
      provider: 'openai',
      model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      },
      finishReason: finishReason(choice?.finish_reason),
    };
  },
};

/** Chat Completions finish_reason: stop | length | content_filter | tool_calls | function_call. */
function finishReason(raw: string | null | undefined): FinishReason {
  if (raw === 'length') return 'length';
  if (raw === 'content_filter') return 'refusal';
  return raw === 'stop' ? 'stop' : 'other';
}
