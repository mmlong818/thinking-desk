import { describe, expect, it } from 'vitest';
import { FeatureRevisionSchema } from './revise-features';
import { invalidRevision, validRevision } from './__fixtures__/revise-features';

describe('FeatureRevisionSchema', () => {
  it('accepts valid / rejects missing summary', () => {
    expect(FeatureRevisionSchema.parse(validRevision).revisions[0].source_leap_ids).toEqual([]);
    expect(FeatureRevisionSchema.safeParse(invalidRevision).success).toBe(false);
  });
});
