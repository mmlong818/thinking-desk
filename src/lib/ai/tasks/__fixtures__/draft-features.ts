import { many, without } from './helpers';

export const validFeature = (i: number) => ({
  id: `f-${i}`,
  name: `Feature ${i}`,
  description: 'd',
  pillar: 'pl-1',
  traces: {},
  kano: 'must',
  rice: { reach: 100, impact: 1, confidence: 0.8, effort: 1 },
  rice_score: 80,
  five_questions: {
    why_do: 'a',
    why_this_way: 'b',
    alternatives: 'c',
    what_if_not: 'd',
    what_if_wrong: 'e',
  },
  core_hypothesis: 'h',
  validation_metric: 'm',
  failure_signal: 's',
});

export const validPillars = many(2, (i) => ({ id: `pl-${i}`, name: `Pillar ${i}`, description: 'd' }));

export const validFeatureList = {
  pillars: validPillars,
  features: many(5, validFeature),
  not_doing: [{ name: 'n', reason: 'boundary', why: 'w' }],
  differentiation_echo: 'e',
  critiques: [],
};
export const invalidFeatureList = without(validFeatureList, 'features');
