import { describe, expect, it } from 'vitest';
import { DesignProposalSchema } from './generate-design';
import { invalidDesign, validDesign } from './__fixtures__/generate-design';

describe('DesignProposalSchema', () => {
  it('accepts valid / rejects missing modules', () => {
    expect(DesignProposalSchema.safeParse(validDesign).success).toBe(true);
    expect(DesignProposalSchema.safeParse(invalidDesign).success).toBe(false);
  });
});
