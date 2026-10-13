import { describe, expect, it } from 'vitest';
import { failureRecord, FollowUpsFailureSchema, inputsKey, planFollowUps, type FollowUpsCache } from './follow-ups-state';

const inputs = [{ itemId: 'per_a', version: 1 }, { itemId: 'job_b', version: 2 }];
const cache: FollowUpsCache = { items: [{ field: 'f', question: 'q', options: [] }], answers: {} };

describe('follow-ups: when to call the AI', () => {
  it('shows cached follow-ups and stays idle without content', () => {
    expect(planFollowUps({ cache, failure: null, inputs })).toEqual({ kind: 'show', cache });
    expect(planFollowUps({ cache: null, failure: null, inputs: [] })).toEqual({ kind: 'idle' });
  });

  it('derives the first time content exists', () => {
    expect(planFollowUps({ cache: null, failure: null, inputs })).toEqual({ kind: 'derive' });
  });

  it('does not derive again after a failure on the same inputs (every later visit shows the failure)', () => {
    const failure = failureRecord(inputs, '未配置 API key', new Date('2026-10-13T00:00:00Z'));
    expect(FollowUpsFailureSchema.parse(failure)).toEqual(failure);
    for (let visit = 0; visit < 3; visit++) {
      expect(planFollowUps({ cache: null, failure, inputs: [...inputs].reverse() })).toEqual({ kind: 'failed', message: '未配置 API key' });
    }
  });

  it('derives again once the inputs changed: an edited, added or removed item', () => {
    const failure = failureRecord(inputs, 'boom');
    const edited = [inputs[0], { ...inputs[1], version: 3 }];
    const added = [...inputs, { itemId: 'sum_c', version: 1 }];
    for (const next of [edited, added, inputs.slice(0, 1)]) {
      expect(planFollowUps({ cache: null, failure, inputs: next })).toEqual({ kind: 'derive' });
    }
  });

  it('fingerprints inputs by id and version, independent of order', () => {
    expect(inputsKey(inputs)).toBe(inputsKey([...inputs].reverse()));
    expect(inputsKey(inputs)).not.toBe(inputsKey([inputs[0], { ...inputs[1], version: 1 }]));
  });
});
