import { describe, expect, it } from 'vitest';
import { withPermanentIds } from './permanent-ids';

describe('withPermanentIds', () => {
  it('rewrites every string equal to a temp ref, at any depth, without touching the input', () => {
    const out = { jobs: [{ id: 'j1', persona_ids: ['p1'] }], note: 'j1 is a job', n: 1 };
    const next = withPermanentIds(out, { 'job:j1': 'itm_a', 'persona:p1': 'itm_b' });
    expect(next).toEqual({ jobs: [{ id: 'itm_a', persona_ids: ['itm_b'] }], note: 'j1 is a job', n: 1 });
    expect(out.jobs[0].id).toBe('j1');
  });

  it('leaves a ref two items share as it was', () => {
    expect(withPermanentIds(['x1'], { 'pillar:x1': 'itm_a', 'feature:x1': 'itm_b' })).toEqual(['x1']);
  });
});
