import { describe, expect, it } from 'vitest';
import { SubfeatureBreakdownSchema } from './split-subfeatures';
import { invalidBreakdown, validBreakdown } from './__fixtures__/split-subfeatures';

describe('SubfeatureBreakdownSchema', () => {
  it('accepts valid and applies defaults', () => {
    const r = SubfeatureBreakdownSchema.parse(validBreakdown);
    expect(r.critical_path).toEqual([]);
    expect(r.splits[0].module_id).toBe('');
    expect(r.splits[0].subfeatures[0].dependencies).toEqual([]);
  });

  it('rejects a response missing splits', () => {
    expect(SubfeatureBreakdownSchema.safeParse(invalidBreakdown).success).toBe(false);
  });
});
