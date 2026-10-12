import { describe, expect, it } from 'vitest';
import { AlternativesAnalysisSchema } from './analyze-alternatives';
import { invalidAlternatives, validAlternatives } from './__fixtures__/alternatives';

describe('AlternativesAnalysisSchema', () => {
  it('accepts a minimal valid response', () => {
    expect(AlternativesAnalysisSchema.safeParse(validAlternatives).success).toBe(true);
  });

  it('rejects a response missing a required field', () => {
    const r = AlternativesAnalysisSchema.safeParse(invalidAlternatives);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['differentiation_hypothesis']);
  });

  it('enforces the minimum number of alternatives', () => {
    const tooFew = { ...validAlternatives, alternatives: validAlternatives.alternatives.slice(0, 5) };
    expect(AlternativesAnalysisSchema.safeParse(tooFew).success).toBe(false);
  });
});
