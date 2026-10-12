import { many, without } from './helpers';

const firstPrinciple = (i: number) => ({
  id: `fp-${i}`,
  industry_assumption: 'a',
  physical_floor: 'f',
  opportunity: 'o',
  feasibility: 'medium',
});
const analogy = (i: number) => ({
  id: `an-${i}`,
  core_essence: 'c',
  source_domain: 'd',
  source_mechanism: 'm',
  transferred_mechanism: 't',
  adaptation_notes: 'n',
  feasibility: 'high',
});
const constraintFlip = (i: number) => ({
  id: `cf-${i}`,
  flip_type: 'remove_constraint',
  original: 'o',
  flipped: 'f',
  surprise: 's',
  impact_on_features: 'i',
  feasibility: 'low',
});

export const validLeap = {
  first_principles: many(4, firstPrinciple),
  analogies: many(4, analogy),
  constraint_flips: many(6, constraintFlip),
  recommendation: {
    timing_verdict: 'selective',
    timing_reason: 'r',
    top_picks: [{ source_method: 'analogy', source_id: 'an-1', why: 'w', required_changes: ['c'] }],
  },
  critiques: [],
};
export const invalidLeap = without(validLeap, 'recommendation');

export const validMoreItems = { analogies: many(3, analogy) };
// Items inside the optional list still need their required fields.
export const invalidMoreItems = { analogies: [{ id: 'an-1' }] };
