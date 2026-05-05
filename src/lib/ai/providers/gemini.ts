import type { AiProvider, CompleteRequest, CompleteResult, ChatMessage } from '../types';
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

    const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const started = Date.now();

    const body: Record<string, unknown> = {
      contents: toContents(req.messages),
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: {
        temperature: req.temperature ?? 0.3,
        maxOutputTokens: req.maxTokens ?? 4096,
        responseMimeType: req.schema ? 'application/json' : 'text/plain',
        responseSchema: req.schema,
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
      candidates?: { content?: { parts?: { text?: string }[] } }[];
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
    const data = req.schema ? JSON.parse(text) : text;

    return {
      data,
      text,
      provider: 'gemini',
      model,
      latencyMs: Date.now() - started,
      usage: {
        inputTokens: json.usageMetadata?.promptTokenCount,
        outputTokens: json.usageMetadata?.candidatesTokenCount,
      },
    };
  },
};
