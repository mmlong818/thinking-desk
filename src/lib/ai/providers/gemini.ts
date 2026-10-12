import type { AiProvider, CompleteResult, ChatMessage, FinishReason } from '../types';
import { adaptSchema, GEMINI_DIALECT, schemaInstruction } from '../json-schema';
import { validateBaseUrl } from './validate-base-url';

interface GeminiPart { text: string }
interface GeminiContent { role: 'user' | 'model'; parts: GeminiPart[] }

function toContents(messages: ChatMessage[]): GeminiContent[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
}

export const geminiProvider: AiProvider = {
  name: 'gemini',
  isConfigured: () => !!process.env.GEMINI_API_KEY,
  async listModels() {
    if (!process.env.GEMINI_API_KEY) return [];
    try {
      const base = validateBaseUrl('gemini', process.env.GEMINI_BASE_URL) || 'https://generativelanguage.googleapis.com';
      const res = await fetch(`${base}/v1beta/models?key=${process.env.GEMINI_API_KEY}`);
      if (!res.ok) return [];
      const json = (await res.json()) as {
        models?: { name: string; displayName?: string; supportedGenerationMethods?: string[] }[];
      };
      return (json.models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName ?? m.name }));
    } catch {
      return [];
    }
  },
  async complete(model, req): Promise<CompleteResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY not configured');
    const base = validateBaseUrl('gemini', process.env.GEMINI_BASE_URL) || 'https://generativelanguage.googleapis.com';
    const url = `${base}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${apiKey}`;

    const native = req.schema ? adaptSchema(req.schema, GEMINI_DIALECT) : null;
    const system = [
      ...req.messages.filter((m) => m.role === 'system').map((m) => m.content),
      req.schema && !native ? schemaInstruction(req.schema) : null,
    ].filter(Boolean).join('\n\n');
    const started = Date.now();

    const body: Record<string, unknown> = {
      contents: toContents(req.messages),
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: {
        temperature: req.temperature ?? 0.3,
        maxOutputTokens: req.maxTokens ?? 4096,
        responseMimeType: req.schema ? 'application/json' : 'text/plain',
        // JSON Schema form (mutually exclusive with the OpenAPI-subset `responseSchema`).
        ...(native ? { responseJsonSchema: native } : {}),
      },
      // Gemini grounding via Google Search — only available on supported models.
      tools: req.webSearch ? [{ googleSearch: {} }] : undefined,
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: req.signal,
    });
    if (!res.ok) {
      throw new Error(`Gemini ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const candidate = json.candidates?.[0];

    return {
      text: candidate?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
      provider: 'gemini',
      model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount,
        outputTokens: json.usageMetadata?.candidatesTokenCount,
      },
      finishReason: finishReason(candidate?.finishReason),
    };
  },
};

function finishReason(raw: string | undefined): FinishReason {
  if (raw === 'MAX_TOKENS') return 'length';
  if (raw === 'SAFETY') return 'refusal';
  return raw === 'STOP' ? 'stop' : 'other';
}
