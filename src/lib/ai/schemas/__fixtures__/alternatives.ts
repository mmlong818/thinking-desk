import { many, without } from './helpers';

export const validAlternatives = {
  alternatives: many(6, (i) => ({
    id: `alt-${i}`,
    name: `Alt ${i}`,
    category: 'direct',
    description: 'd',
    why_users_use: 'w',
    threat_level: 'medium',
  })),
  strategic_profiles: many(2, (i) => ({
    alt_id: `alt-${i}`,
    promise: 'p',
    revenue_model: 'r',
    moat: 'm',
    moat_strength: 'weak',
  })),
  feature_breakdowns: [],
  differentiation_hypothesis: 'h',
  key_threats: ['t'],
  critiques: [],
};

export const invalidAlternatives = without(validAlternatives, 'differentiation_hypothesis');
