import { describe, expect, it } from 'vitest';
import { taskJsonSchema } from '../json-schema';
import { ClarifyResultSchema } from '../schemas/clarify-brief';
import { UsersAnalysisSchema } from '../schemas/analyze-users';
import type { CompleteRequest } from '../types';
import { DEFAULT_VISIBLE_TOKENS, REASONING_HEADROOM_TOKENS } from './budget';
import { buildGeminiRequest } from './gemini';
import { buildOpenAIRequest } from './openai';

const req = (over: Partial<CompleteRequest> = {}): CompleteRequest => ({
  task: 'USERS_JTBD',
  messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }],
  schema: taskJsonSchema(UsersAnalysisSchema), maxTokens: 10000, temperature: 0.4, ...over,
});

describe('buildOpenAIRequest', () => {
  it('reasoning families: max_completion_tokens with reasoning headroom, no temperature', () => {
    const body = buildOpenAIRequest('gpt-6.1-sol', req());
    expect(body).toMatchObject({ max_completion_tokens: 10000 + REASONING_HEADROOM_TOKENS, response_format: { type: 'json_object' } });
    expect(body).not.toHaveProperty('temperature');
    expect(buildOpenAIRequest('gpt-6.1-sol', req({ maxTokens: undefined })).max_completion_tokens)
      .toBe(DEFAULT_VISIBLE_TOKENS + REASONING_HEADROOM_TOKENS);
  });

  it('4.x families keep max_tokens + temperature', () => {
    expect(buildOpenAIRequest('gpt-4o', req())).toMatchObject({ max_tokens: 10000, temperature: 0.4 });
  });

  it('describes the schema in a system message (JSON mode)', () => {
    const messages = buildOpenAIRequest('gpt-6.1-sol', req()).messages as { role: string; content: string }[];
    expect(messages.filter((m) => m.role === 'system').map((m) => m.content)[1]).toContain('你必须只输出 JSON');
  });
});

describe('buildGeminiRequest', () => {
  it('uses responseJsonSchema (Gemini dialect) and thinking headroom', () => {
    const body = buildGeminiRequest(req());
    const config = body.generationConfig as Record<string, unknown>;
    expect(config).toMatchObject({ responseMimeType: 'application/json', maxOutputTokens: 10000 + REASONING_HEADROOM_TOKENS });
    expect(config.responseJsonSchema).toMatchObject({ type: 'object' });
    expect(config).not.toHaveProperty('responseSchema');
    expect(JSON.stringify(config.responseJsonSchema)).not.toContain('"const"');
    expect(body.systemInstruction).toEqual({ parts: [{ text: 'SYS' }] });
  });

  it('caps maxOutputTokens at the 64k output limit', () => {
    const config = buildGeminiRequest(req({ maxTokens: 60_000 })).generationConfig as Record<string, unknown>;
    expect(config.maxOutputTokens).toBe(65_536);
  });

  it('falls back to JSON mode + schema in the system instruction for a union-root schema', () => {
    const body = buildGeminiRequest(req({ schema: taskJsonSchema(ClarifyResultSchema) }));
    expect(body.generationConfig).not.toHaveProperty('responseJsonSchema');
    expect(JSON.stringify(body.systemInstruction)).toContain('你必须只输出 JSON');
  });
});
