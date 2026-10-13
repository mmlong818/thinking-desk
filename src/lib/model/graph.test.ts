import { describe, expect, it } from 'vitest';
import { isStale, liveGraph, staleItems, staleRuns } from './graph';
import type { Link, Run } from './types';
import { jobBody, makeItem, PROJECT, T0, T1 } from './__fixtures__/model';

const persona = makeItem({ id: 'per_1', version: 3 });
const job = makeItem({ id: 'job_1', type: 'job', body: jobBody() });
const gone = makeItem({ id: 'per_2', version: 5, deletedAt: T1 });

const link = (id: string, from: string, to: string, toVersionSeen: number): Link => ({
  id, projectId: PROJECT, from, to, rel: 'derived_from', toVersionSeen,
});

describe('isStale', () => {
  it('is stale only when the upstream version moved past toVersionSeen', () => {
    expect(isStale(link('l1', 'job_1', 'per_1', 2), [persona, job])).toBe(true);
    expect(isStale(link('l1', 'job_1', 'per_1', 3), [persona, job])).toBe(false);
  });

  it('is never stale for a missing or deleted upstream (that is a dangling link)', () => {
    expect(isStale(link('l1', 'job_1', 'nope', 1), [job])).toBe(false);
    expect(isStale(link('l1', 'job_1', 'per_2', 1), new Map([[gone.id, gone]]))).toBe(false);
  });
});

describe('liveGraph', () => {
  it('drops deleted items and every link touching them', () => {
    const g = liveGraph([persona, job, gone], [link('l1', 'job_1', 'per_1', 3), link('l2', 'job_1', 'per_2', 5)]);
    expect(g.items.map((i) => i.id)).toEqual(['per_1', 'job_1']);
    expect(g.links.map((l) => l.id)).toEqual(['l1']);
  });
});

describe('staleItems', () => {
  it('groups stale outgoing links by the downstream item', () => {
    const p2 = makeItem({ id: 'per_3', version: 2 });
    const g = liveGraph(
      [persona, p2, job],
      [link('l1', 'job_1', 'per_1', 1), link('l2', 'job_1', 'per_3', 1), link('l3', 'per_3', 'per_1', 3)],
    );
    const stale = staleItems(g);
    expect(stale).toHaveLength(1);
    expect(stale[0].item.id).toBe('job_1');
    expect(stale[0].links.map((l) => l.id)).toEqual(['l1', 'l2']);
  });
});

describe('staleRuns', () => {
  const run = (id: string, inputs: Run['inputs'], status: Run['status'] = 'ok'): Run => ({
    id, projectId: PROJECT, task: 'USERS_JTBD', node: 'users', provider: 'claude', model: 'm',
    promptVersion: 'h', inputs, status, latencyMs: 1, createdAt: T0,
  });

  it('reports inputs that changed or were deleted since the run', () => {
    const r = staleRuns(
      [run('r1', [{ itemId: 'per_1', version: 2 }, { itemId: 'job_1', version: 1 }, { itemId: 'per_2', version: 5 }])],
      [persona, job, gone],
    );
    expect(r).toHaveLength(1);
    expect(r[0].changed).toEqual([
      { itemId: 'per_1', seen: 2, current: 3 },
      { itemId: 'per_2', seen: 5, current: null },
    ]);
  });

  it('ignores up-to-date and failed runs', () => {
    expect(staleRuns([run('r1', [{ itemId: 'per_1', version: 3 }])], [persona])).toEqual([]);
    expect(staleRuns([run('r2', [{ itemId: 'per_1', version: 1 }], 'failed')], [persona])).toEqual([]);
  });
});
