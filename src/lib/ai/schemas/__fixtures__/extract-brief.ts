import { without } from './helpers';

export const validBrief = {
  highlights: [{ text: 't', kind: 'fact' }],
  fields: {
    problem_statement: 'p',
    target_user: null,
    scenario: null,
    value_prop: null,
    success_criteria: null,
    time_constraint: null,
    boundaries: [],
  },
  follow_ups: [],
  completeness: 40,
};
export const invalidBrief = without(validBrief, 'completeness');
