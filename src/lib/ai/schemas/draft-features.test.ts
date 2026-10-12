import { describe, expect, it } from 'vitest';
import { FeatureListSchema } from './draft-features';
import { invalidFeatureList, validFeature, validFeatureList } from './__fixtures__/draft-features';

describe('FeatureListSchema', () => {
  it('accepts valid and applies feature defaults', () => {
    const r = FeatureListSchema.parse(validFeatureList);
    expect(r.features[0].red_line_risk).toBe(false);
    expect(r.features[0].group).toBe('');
  });

  it('rejects a response missing features', () => {
    expect(FeatureListSchema.safeParse(invalidFeatureList).success).toBe(false);
  });

  it('rejects an invalid kano value', () => {
    const bad = {
      ...validFeatureList,
      features: [{ ...validFeature(1), kano: 'wow' }, ...validFeatureList.features.slice(1)],
    };
    expect(FeatureListSchema.safeParse(bad).success).toBe(false);
  });
});
