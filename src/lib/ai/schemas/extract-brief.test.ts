import { describe, expect, it } from 'vitest';
import { BriefExtractionSchema } from './extract-brief';
import { invalidBrief, validBrief } from './__fixtures__/extract-brief';

describe('BriefExtractionSchema', () => {
  it('accepts valid and defaults red_lines', () => {
    expect(BriefExtractionSchema.parse(validBrief).fields.red_lines).toEqual([]);
  });

  it('keeps AI-inferred red lines apart from the stated ones, defaulting to none', () => {
    const r = BriefExtractionSchema.parse(validBrief);
    expect(r.inferred_red_lines).toEqual([]);
    expect(r.fields).not.toHaveProperty('inferred_red_lines');
    const inferred = { text: '不使用虚假紧迫感', reason: '消费类 App 常见套路' };
    expect(BriefExtractionSchema.parse({ ...validBrief, inferred_red_lines: [inferred] }).inferred_red_lines).toEqual([inferred]);
  });

  it('rejects an inferred red line without its reason', () => {
    expect(BriefExtractionSchema.safeParse({ ...validBrief, inferred_red_lines: [{ text: 'x' }] }).success).toBe(false);
  });

  it('rejects a response missing completeness', () => {
    expect(BriefExtractionSchema.safeParse(invalidBrief).success).toBe(false);
  });

  it('rejects completeness outside 0-100', () => {
    expect(BriefExtractionSchema.safeParse({ ...validBrief, completeness: 101 }).success).toBe(false);
  });
});
