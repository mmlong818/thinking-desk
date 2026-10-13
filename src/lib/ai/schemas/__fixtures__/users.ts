import { many, without } from './helpers';

const job = (id: string) => ({ id, title: 't', reach: 5, impact: 2, source: 's' });

const persona = (i: number) => ({
  id: `p-${i}`,
  role: i === 1 ? 'primary' : 'candidate',
  name: `P ${i}`,
  one_liner: 'o',
  meta: 'm',
  story: 's',
  pain: 'p',
});

const jobs = { functional: [job('j1')], emotional: [job('j2')], social: [] };

export const validUsers = {
  personas: [persona(1)],
  jobs,
  priority_summary: 's',
  critiques: [],
};
export const invalidUsers = without(validUsers, 'personas');

export const validJobsRefinement = { jobs, priority_summary: 's', critiques: [] };
export const invalidJobsRefinement = without(validJobsRefinement, 'jobs');

export const validPersonaBatch = { personas: many(2, persona) };
export const invalidPersonaBatch = {};
