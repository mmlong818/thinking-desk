import { describe, expect, it } from 'vitest';
import { FeatureSchema, type Feature } from '../ai/schemas/draft-features';
import { validFeature } from '../ai/schemas/__fixtures__/draft-features';
import { acceptedFeatures } from './chain';

const feature = (i: number, over: Partial<Feature> = {}): Feature => ({ ...FeatureSchema.parse(validFeature(i)), ...over });
const ids = (fs: Feature[]) => fs.map((f) => f.id);

describe('acceptedFeatures', () => {
  it('takes what the AI recommends when that is three or more', () => {
    const fs = [1, 2, 3, 4].map((i) => feature(i, { suggested_priority: i !== 4, rice_score: i }));
    expect(ids(acceptedFeatures(fs))).toEqual(['f-1', 'f-2', 'f-3']);
  });

  it('tops a short recommendation up to three by RICE, never with a red-line risk', () => {
    const fs = [
      feature(1, { suggested_priority: true, rice_score: 10 }),
      feature(2, { rice_score: 500, red_line_risk: true }),
      feature(3, { rice_score: 50 }),
      feature(4, { rice_score: 200 }),
      feature(5, { rice_score: 120 }),
    ];
    expect(ids(acceptedFeatures(fs))).toEqual(['f-1', 'f-4', 'f-5']);
  });

  it('takes everything when nothing is free of red-line risk', () => {
    const fs = [feature(1, { red_line_risk: true }), feature(2, { red_line_risk: true })];
    expect(ids(acceptedFeatures(fs))).toEqual(['f-1', 'f-2']);
  });
});
