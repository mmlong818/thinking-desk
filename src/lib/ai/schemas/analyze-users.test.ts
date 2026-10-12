import { describe, expect, it } from 'vitest';
import { JobsRefinementSchema, PersonaBatchSchema, UsersAnalysisSchema } from './analyze-users';
import {
  invalidJobsRefinement,
  invalidPersonaBatch,
  invalidUsers,
  validJobsRefinement,
  validPersonaBatch,
  validUsers,
} from './__fixtures__/users';

describe('UsersAnalysisSchema', () => {
  it('accepts a minimal valid response and defaults job flags', () => {
    const r = UsersAnalysisSchema.parse(validUsers);
    expect(r.jobs.functional[0].suggested_priority).toBe(false);
    expect(r.jobs.functional[0].persona_ids).toEqual([]);
  });

  it('rejects a response missing a required field', () => {
    expect(UsersAnalysisSchema.safeParse(invalidUsers).success).toBe(false);
  });

  it('rejects out-of-range job scores', () => {
    const bad = structuredClone(validUsers);
    bad.jobs.functional[0].impact = 5;
    expect(UsersAnalysisSchema.safeParse(bad).success).toBe(false);
  });
});

describe('JobsRefinementSchema', () => {
  it('accepts valid / rejects missing jobs', () => {
    expect(JobsRefinementSchema.safeParse(validJobsRefinement).success).toBe(true);
    expect(JobsRefinementSchema.safeParse(invalidJobsRefinement).success).toBe(false);
  });
});

describe('PersonaBatchSchema', () => {
  it('accepts valid / rejects missing personas', () => {
    expect(PersonaBatchSchema.safeParse(validPersonaBatch).success).toBe(true);
    expect(PersonaBatchSchema.safeParse(invalidPersonaBatch).success).toBe(false);
  });
});
