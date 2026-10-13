import { describe, expect, it } from 'vitest';
import { StakeholdersAnalysisSchema } from './analyze-stakeholders';
import { invalidStakeholders, validStakeholders } from './__fixtures__/stakeholders';

describe('StakeholdersAnalysisSchema', () => {
  it('accepts a minimal valid response and applies defaults', () => {
    const r = StakeholdersAnalysisSchema.parse(validStakeholders);
    expect(r.stakeholders[0].required).toBe(false);
    expect(r.stakeholders[0].engagement_hint).toBe('');
  });

  it('rejects a response missing a required field', () => {
    const r = StakeholdersAnalysisSchema.safeParse(invalidStakeholders);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(['engagement_plan']);
  });
});
