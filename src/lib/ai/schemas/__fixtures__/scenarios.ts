import { many, without } from './helpers';

const elements = () => many(6, (i) => ({ id: `e-${i}`, text: 't' }));

export const validDimensions = {
  dimensions: {
    time: elements(),
    place: elements(),
    people: elements(),
    trigger: elements(),
    process: elements(),
    tools: elements(),
    conditions: elements(),
  },
};
export const invalidDimensions = {
  dimensions: without(validDimensions.dimensions, 'conditions'),
};

export const validScenarioDrafts = {
  scenarios: many(5, (i) => ({
    id: `sc-${i}`,
    title: 't',
    meta: 'm',
    narrative: 'n',
    element_ids: ['e-1', 'e-2', 'e-3'],
    pain_hint: 'p',
  })),
};
export const invalidScenarioDrafts = {};

export const validDeepAnalysis = {
  matrix: [],
  extremes: many(3, (i) => ({
    id: `x-${i}`,
    dim: 'time',
    pushed_to_limit: 'p',
    description: 'd',
    robustness_gap: 'g',
  })),
  hostiles: many(2, (i) => ({
    id: `h-${i}`,
    attack: 'a',
    vulnerable_users: 'v',
    mitigation: 'm',
    severity: 'low',
  })),
  pain_points: many(3, (i) => ({
    id: `pp-${i}`,
    scenario_id: 'sc-1',
    moment: 'm',
    feeling: 'f',
    why_1: 'a',
    why_2: 'b',
    why_3: 'c',
    root_cause: 'r',
  })),
  delight_points: [],
  design_insights: many(3, (i) => ({
    id: `di-${i}`,
    scenario_id: 'sc-1',
    insight_text: 't',
    action: 'a',
  })),
  critiques: [],
};
export const invalidDeepAnalysis = without(validDeepAnalysis, 'pain_points');
