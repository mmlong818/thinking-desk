import type { AiProvider, CompleteRequest, CompleteResult } from '../types';
import { validateBaseUrl } from './validate-base-url';

// Zhipu exposes an OpenAI-compatible Chat Completions endpoint. We call it
// via fetch to avoid pulling in another SDK.
// Zhipu doesn't always expose /models reliably. We probe and fall back to a
// curated list of currently-usable models if the endpoint is unreachable.
const ZHIPU_FALLBACK = [
  { id: 'glm-4-plus',    label: 'GLM-4 Plus · 旗舰' },
  { id: 'glm-4-air',     label: 'GLM-4 Air · 性价比' },
  { id: 'glm-4-long',    label: 'GLM-4 Long · 长上下文' },
  { id: 'glm-4-flash',   label: 'GLM-4 Flash · 超快' },
  { id: 'glm-zero-preview', label: 'GLM-Zero · 推理预览' },
];

function safeParseJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    throw new Error(`Zhipu response is not valid JSON. First 300 chars: ${trimmed.slice(0, 300)}`);
  }
}

export const zhipuProvider: AiProvider = {
  name: 'zhipu',
  isConfigured: () => !!process.env.ZHIPU_API_KEY,
  async listModels() {
    if (!process.env.ZHIPU_API_KEY) return [];
    const base = validateBaseUrl('zhipu', process.env.ZHIPU_BASE_URL) || 'https://open.bigmodel.cn/api/paas/v4';
    try {
      const res = await fetch(`${base}/models`, {
        headers: { authorization: `Bearer ${process.env.ZHIPU_API_KEY}` },
      });
      if (!res.ok) return ZHIPU_FALLBACK;
      const json = (await res.json()) as { data?: { id: string }[] };
      const ids = (json.data ?? []).map((m) => m.id);
      if (ids.length === 0) return ZHIPU_FALLBACK;
      // Keep a friendly label from fallback if we have one.
      const labelled = ids.map((id) => {
        const match = ZHIPU_FALLBACK.find((f) => f.id === id);
        return { id, label: match?.label ?? id };
      });
      return labelled;
    } catch {
      return ZHIPU_FALLBACK;
    }
  },
  async complete(model, req): Promise<CompleteResult> {
    const apiKey = process.env.ZHIPU_API_KEY;
    if (!apiKey) throw new Error('ZHIPU_API_KEY not configured');
    const base = validateBaseUrl('zhipu', process.env.ZHIPU_BASE_URL) || 'https://open.bigmodel.cn/api/paas/v4';
    const started = Date.now();

    const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));
    if (req.schema) {
      messages.push({
        role: 'system',
        content: `输出必须是 JSON，且严格符合以下 schema：\n${JSON.stringify(req.schema)}`,
      });
    }

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: req.temperature ?? 0.3,
      max_tokens: req.maxTokens ?? 8000,
      response_format: req.schema ? { type: 'json_object' } : undefined,
      tools: req.webSearch ? [{ type: 'web_search', web_search: { enable: true } }] : undefined,
      // GLM-4.5+ reasoning models burn huge token budgets in reasoning_content
      // before emitting the actual answer. For structured-output tasks we
      // always want the JSON, not the thinking trace — disable reasoning.
      thinking: req.schema ? { type: 'disabled' } : undefined,
    };
    // When web search is enabled, override tools with the Zhipu-specific shape
    // that also returns citations so the UI can attribute sources.
    if (req.webSearch) {
      body.tools = [
        {
          type: 'web_search',
          web_search: { enable: true, search_result: true },
        },
      ];
      // Web search dramatically increases output — give extra headroom.
      body.max_tokens = Math.max(Number(body.max_tokens ?? 0), 12000);
    }

    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new Error(`Zhipu ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      choices?: { message?: { content?: string }; finish_reason?: string }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const choice = json.choices?.[0];
    const text = choice?.message?.content ?? '';
    if (!text.trim()) {
      const hint =
        choice?.finish_reason === 'length'
          ? '（finish_reason=length：模型未在预算内完成输出，考虑增大 maxTokens 或切换非推理模型）'
          : '';
      throw new Error(
        `Zhipu returned empty content (finish_reason=${choice?.finish_reason ?? 'unknown'}) ${hint}. ` +
          `Raw: ${JSON.stringify(json).slice(0, 500)}`,
      );
    }
    const data = req.schema ? safeParseJson(text) : text;

    return {
      data,
      text,
      provider: 'zhipu',
      model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: json.usage?.prompt_tokens,
        outputTokens: json.usage?.completion_tokens,
      },
    };
  },
};
