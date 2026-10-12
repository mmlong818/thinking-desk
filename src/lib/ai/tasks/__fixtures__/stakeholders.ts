import { many, without } from './helpers';

export const validStakeholders = {
  stakeholders: many(5, (i) => ({
    id: `s-${i}`,
    name: `S ${i}`,
    role: 'r',
    power: 'high',
    interest: 'low',
    note: 'n',
    source: 'brief',
    category: 'other',
  })),
  engagement_plan: { manage: 'a', satisfy: 'b', inform: 'c', monitor: 'd' },
  priority_summary: 's',
  critiques: [],
};

export const invalidStakeholders = without(validStakeholders, 'engagement_plan');
