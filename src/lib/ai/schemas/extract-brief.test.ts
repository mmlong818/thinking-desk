import { describe, expect, it } from 'vitest';
import { BriefExtractionSchema } from './extract-brief';
import { invalidBrief, validBrief } from './__fixtures__/extract-brief';

describe('BriefExtractionSchema', () => {
  it('accepts valid and defaults red_lines', () => {
    expect(BriefExtractionSchema.parse(validBrief).fields.red_lines).toEqual([]);
  });

  it('rejects a response missing completeness', () => {
    expect(BriefExtractionSchema.safeParse(invalidBrief).success).toBe(false);
  });

  it('rejects completeness outside 0-100', () => {
    expect(BriefExtractionSchema.safeParse({ ...validBrief, completeness: 101 }).success).toBe(false);
  });
});
