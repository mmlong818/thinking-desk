import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { taskJsonSchema } from '../json-schema';
import { ClarifyResultSchema } from '../schemas/clarify-brief';
import { BriefExtractionSchema } from '../schemas/extract-brief';
import type { CompleteRequest } from '../types';
import { buildClaudeRequest } from './claude';
import { REASONING_HEADROOM_TOKENS } from './budget';
import { claudeFamily, claudeRequestParams, CLAUDE_FAMILIES, UNKNOWN_CLAUDE_FAMILY } from './claude-params';

const schema = taskJsonSchema(BriefExtractionSchema);
const req = (over: Partial<CompleteRequest> = {}): CompleteRequest => ({
  task: 'BRIEF_EXTRACT',
  messages: [{ role: 'system', content: 'SYS' }, { role: 'user', content: 'hi' }],
  schema, maxTokens: 8000, temperature: 0.2, ...over,
});

describe('claudeRequestParams · per model family', () => {
  it('Sonnet 5.5: no temperature, structured output, low effort, thinking headroom', () => {
    const p = claudeRequestParams('claude-sonnet-5-5', req());
    expect(p).toMatchObject({ effort: 'low', maxTokens: 8000 + REASONING_HEADROOM_TOKENS, schemaInPrompt: false });
    expect(p).not.toHaveProperty('temperature');
    expect(p.outputSchema).toMatchObject({ type: 'object', additionalProperties: false });
  });

  it('Opus 5.5: no temperature, structured output, medium effort', () => {
    const p = claudeRequestParams('claude-opus-5-5', req());
    expect(p).toMatchObject({ effort: 'medium', schemaInPrompt: false });
    expect(p).not.toHaveProperty('temperature');
  });

  it('Sonnet 4.6: keeps the task temperature, schema in the prompt, no effort, no headroom', () => {
    const p = claudeRequestParams('claude-sonnet-4-6', req());
    expect(p).toEqual({ maxTokens: 8000, temperature: 0.2, schemaInPrompt: true });
  });

  it('Haiku 4.5 (dated snapshot): temperature and structured output, never effort', () => {
    const p = claudeRequestParams('claude-haiku-4-5-20251001', req({ effort: 'high' }));
    expect(p).toMatchObject({ temperature: 0.2, schemaInPrompt: false, maxTokens: 8000 });
    expect(p).not.toHaveProperty('effort');
  });

  it('Opus 4.7: no sampling and no structured output (not in the supported list)', () => {
    const p = claudeRequestParams('claude-opus-4-7', req());
    expect(p).toEqual({ maxTokens: 8000, schemaInPrompt: true });
  });

  it('honours a task effort only when the model supports that level', () => {
    expect(claudeRequestParams('claude-sonnet-5-5', req({ effort: 'high' })).effort).toBe('high');
    expect(claudeRequestParams('claude-opus-4-6', req({ effort: 'high' })).effort).toBe('high');
    expect(claudeRequestParams('claude-sonnet-4-5', req({ effort: 'high' }))).not.toHaveProperty('effort');
  });

  it('falls back to the prompt for a schema the native format cannot express (union root)', () => {
    const p = claudeRequestParams('claude-sonnet-5-5', req({ schema: taskJsonSchema(ClarifyResultSchema) }));
    expect(p).toMatchObject({ schemaInPrompt: true });
    expect(p).not.toHaveProperty('outputSchema');
  });

  it('defaults temperature to 0.3 where sampling is allowed and the task sets none', () => {
    expect(claudeRequestParams('claude-sonnet-4-6', req({ temperature: undefined })).temperature).toBe(0.3);
  });
});

describe('claudeFamily · id matching', () => {
  it('resolves aliases, dated snapshots and platform-prefixed ids', () => {
    expect(claudeFamily('claude-sonnet-5-5')).toBe(CLAUDE_FAMILIES['claude-sonnet-5-5']);
    expect(claudeFamily('us.anthropic.claude-opus-5-5')).toBe(CLAUDE_FAMILIES['claude-opus-5-5']);
    expect(claudeFamily('claude-opus-4-5@20251101')).toBe(CLAUDE_FAMILIES['claude-opus-4-5']);
    expect(claudeFamily('claude-sonnet-4-20250514')).toBe(CLAUDE_FAMILIES['claude-sonnet-4']);
  });

  it('never matches a newer version by prefix (claude-sonnet-5-6 is not Sonnet 5)', () => {
    expect(claudeFamily('claude-sonnet-5-6')).toBe(UNKNOWN_CLAUDE_FAMILY);
    expect(claudeFamily('claude-sonnet-5-5-preview')).toBe(UNKNOWN_CLAUDE_FAMILY);
  });

  it('gives unknown models the request every model accepts', () => {
    expect(claudeRequestParams('claude-next-1', req())).toEqual({ maxTokens: 8000, schemaInPrompt: true });
  });
});

describe('buildClaudeRequest', () => {
  const ids = [...Object.keys(CLAUDE_FAMILIES), 'claude-haiku-4-5-20251001', 'claude-next-1'];

  it.each(ids)('%s: never sends thinking; temperature only where sampling is allowed', (model) => {
    const body = buildClaudeRequest(model, req());
    expect(body).not.toHaveProperty('thinking');
    expect('temperature' in body).toBe(claudeFamily(model).sampling);
    expect(body.max_tokens).toBeLessThanOrEqual(64_000);
  });

  it('Sonnet 5.5 body: output_config with effort and json_schema format, system without the schema', () => {
    const body = buildClaudeRequest('claude-sonnet-5-5', req());
    expect(body.output_config).toMatchObject({ effort: 'low', format: { type: 'json_schema' } });
    expect(body.system).toBe('SYS');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('Sonnet 4.6 body: schema described in the system prompt, no output_config', () => {
    const body = buildClaudeRequest('claude-sonnet-4-6', req());
    expect(body).not.toHaveProperty('output_config');
    expect(body.system).toContain('你必须只输出 JSON');
  });

  it('free-text tasks on Sonnet 5.5 carry only the effort', () => {
    const body = buildClaudeRequest('claude-sonnet-5-5', req({ schema: undefined }));
    expect(body.output_config).toEqual({ effort: 'low' });
  });

  it('keeps a zod-derived schema intact (no mutation of the canonical schema)', () => {
    const canonical = taskJsonSchema(z.object({ a: z.string().min(1) }));
    const before = JSON.stringify(canonical);
    buildClaudeRequest('claude-sonnet-5-5', req({ schema: canonical }));
    expect(JSON.stringify(canonical)).toBe(before);
  });
});
