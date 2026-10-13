import { describe, expect, it } from 'vitest';
import { bodyDiff } from './body-diff';

describe('bodyDiff', () => {
  it('lists changed leaf fields only, with dotted paths', () => {
    const before = { name: '小米', meta: 'm', fields: { problem: '旧', boundaries: ['a', 'b'] } };
    const after = { name: '小米', meta: 'm2', fields: { problem: '新', boundaries: ['a'] }, extra: true };
    expect(bodyDiff(before, after)).toEqual([
      { path: 'meta', before: 'm', after: 'm2' },
      { path: 'fields.problem', before: '旧', after: '新' },
      { path: 'fields.boundaries', before: 'a · b', after: 'a' },
      { path: 'extra', before: '', after: 'true' },
    ]);
  });

  it('indexes arrays of objects, treats null as empty and clips long text', () => {
    const before = { steps: [{ action: 'x' }], note: null, story: 's'.repeat(400) };
    const after = { steps: [{ action: 'y' }], note: '', story: 't'.repeat(400) };
    const diff = bodyDiff(before, after);
    expect(diff.map((d) => d.path)).toEqual(['steps.0.action', 'story']);
    expect(diff[1].after.length).toBe(300);
  });

  it('is empty for equal bodies', () => {
    expect(bodyDiff({ a: [1, 2] }, { a: [1, 2] })).toEqual([]);
  });
});
