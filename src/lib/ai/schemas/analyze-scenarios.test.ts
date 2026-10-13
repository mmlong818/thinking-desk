import { describe, expect, it } from 'vitest';
import { DimensionsResultSchema, ScenarioDeepAnalysisSchema, ScenarioDraftsSchema } from './analyze-scenarios';
import {
  invalidDeepAnalysis,
  invalidDimensions,
  invalidScenarioDrafts,
  validDeepAnalysis,
  validDimensions,
  validScenarioDrafts,
} from './__fixtures__/scenarios';

describe('DimensionsResultSchema', () => {
  it('accepts valid / rejects a missing dimension', () => {
    expect(DimensionsResultSchema.safeParse(validDimensions).success).toBe(true);
    expect(DimensionsResultSchema.safeParse(invalidDimensions).success).toBe(false);
  });
});

describe('ScenarioDraftsSchema', () => {
  it('accepts valid / rejects missing scenarios', () => {
    const r = ScenarioDraftsSchema.parse(validScenarioDrafts);
    expect(r.scenarios[0].job_ids).toEqual([]);
    expect(ScenarioDraftsSchema.safeParse(invalidScenarioDrafts).success).toBe(false);
  });
});

describe('ScenarioDeepAnalysisSchema', () => {
  it('accepts valid / rejects missing pain_points', () => {
    expect(ScenarioDeepAnalysisSchema.safeParse(validDeepAnalysis).success).toBe(true);
    expect(ScenarioDeepAnalysisSchema.safeParse(invalidDeepAnalysis).success).toBe(false);
  });

  it('rejects an unknown extreme-scenario dimension', () => {
    const bad = structuredClone(validDeepAnalysis);
    bad.extremes[0].dim = 'weather';
    expect(ScenarioDeepAnalysisSchema.safeParse(bad).success).toBe(false);
  });
});
