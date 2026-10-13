import { describe, expect, it } from 'vitest';
import { CreativeLeapAnalysisSchema, MoreItemsResultSchema } from './creative-leap';
import { invalidLeap, invalidMoreItems, validLeap, validMoreItems } from './__fixtures__/creative-leap';

describe('CreativeLeapAnalysisSchema', () => {
  it('accepts valid / rejects missing recommendation', () => {
    expect(CreativeLeapAnalysisSchema.safeParse(validLeap).success).toBe(true);
    expect(CreativeLeapAnalysisSchema.safeParse(invalidLeap).success).toBe(false);
  });

  it('requires at least one top pick', () => {
    const bad = structuredClone(validLeap);
    bad.recommendation.top_picks = [];
    expect(CreativeLeapAnalysisSchema.safeParse(bad).success).toBe(false);
  });
});

describe('MoreItemsResultSchema', () => {
  it('accepts a partial result / rejects malformed items', () => {
    expect(MoreItemsResultSchema.safeParse(validMoreItems).success).toBe(true);
    expect(MoreItemsResultSchema.safeParse(invalidMoreItems).success).toBe(false);
  });
});
