import { describe, expect, it } from 'vitest';
import { ClarifyResultSchema } from './clarify-brief';
import { invalidClarify, validClarifyAsk, validClarifyProceed } from './__fixtures__/clarify-brief';

describe('ClarifyResultSchema', () => {
  it('accepts the "proceed" branch', () => {
    expect(ClarifyResultSchema.safeParse(validClarifyProceed).success).toBe(true);
  });

  it('accepts the "ask" branch and applies defaults', () => {
    const r = ClarifyResultSchema.parse(validClarifyAsk);
    expect(r.action).toBe('ask');
    if (r.action === 'ask') {
      expect(r.suggested_mode).toBe('questionnaire');
      expect(r.questions[0].subtitle).toBe('');
    }
  });

  it('rejects "ask" without questions', () => {
    expect(ClarifyResultSchema.safeParse(invalidClarify).success).toBe(false);
  });
});
