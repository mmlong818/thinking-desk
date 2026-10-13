import { describe, expect, it } from 'vitest';
import { applyProgress, entityCount, textTail, type StreamProgress } from './stream-progress';

const attempt = (n: number, retry?: { code: string; issues: string[] }) =>
  ({ type: 'attempt' as const, attempt: n, provider: 'claude', model: 'm', streaming: true, ...(retry ? { retry } : {}) });

describe('applyProgress', () => {
  it('accumulates the deltas of the current attempt and restarts the text on a retry', () => {
    let p: StreamProgress | null = null;
    p = applyProgress(p, attempt(1), 1_000);
    p = applyProgress(p, { type: 'delta', attempt: 1, text: '{"id":"a",' }, 1_100);
    p = applyProgress(p, { type: 'delta', attempt: 1, text: '"id":"b"' }, 1_200);
    expect(p).toMatchObject({ attempt: 1, text: '{"id":"a","id":"b"', startedAt: 1_000 });
    p = applyProgress(p, attempt(2, { code: 'invalid_output', issues: ['x: required'] }), 5_000);
    expect(p).toMatchObject({ attempt: 2, text: '', startedAt: 1_000, retry: { code: 'invalid_output' } });
    p = applyProgress(p, { type: 'delta', attempt: 1, text: 'late' }, 5_100);
    expect(p.text).toBe('');
    p = applyProgress(p, { type: 'delta', attempt: 2, text: '{' }, 5_200);
    expect(p.text).toBe('{');
  });

  it('copes with a delta before any attempt event', () => {
    expect(applyProgress(null, { type: 'delta', attempt: 1, text: 'x' }, 7)).toMatchObject({ attempt: 1, text: 'x', startedAt: 7 });
  });
});

describe('entityCount / textTail', () => {
  it('counts "id" keys and shows the end of the text on one line', () => {
    expect(entityCount('{"dimensions":{"time":[{"id": "t1"},{"id":"t2"}]')).toBe(2);
    expect(textTail('a\n  b', 10)).toBe('a b');
    expect(textTail('0123456789abc', 4)).toBe('…9abc');
  });
});
