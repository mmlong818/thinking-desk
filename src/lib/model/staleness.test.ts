import { describe, expect, it } from 'vitest';
import { liveGraph } from './graph';
import {
  bodyAtVersion, changedInputsKey, latestRunsByTask, nodeRunStaleness, staleIndex, staleOnNode,
} from './staleness';
import type { DecisionEvent, Link, Run } from './types';
import { jobBody, makeItem, personaBody, PROJECT, T0, T1 } from './__fixtures__/model';

const link = (id: string, from: string, to: string, toVersionSeen: number): Link => ({
  id, projectId: PROJECT, from, to, rel: 'derived_from', toVersionSeen,
});

const run = (id: string, task: string, node: Run['node'], inputs: Run['inputs'], status: Run['status'] = 'ok'): Run => ({
  id, projectId: PROJECT, task, node, provider: 'claude', model: 'm', promptVersion: 'h', inputs, status, latencyMs: 1, createdAt: T0,
});

describe('staleIndex', () => {
  const p1 = makeItem({ id: 'per_1', version: 3 });
  const p2 = makeItem({ id: 'per_2', version: 1 });
  const job = makeItem({ id: 'job_1', type: 'job', body: jobBody() });
  const graph = liveGraph([p1, p2, job], [link('l1', 'job_1', 'per_1', 2), link('l2', 'job_1', 'per_2', 1)]);

  it('lists each stale item once with every upstream that changed', () => {
    const index = staleIndex(graph);
    expect([...index.keys()]).toEqual(['job_1']);
    expect(index.get('job_1')?.changes.map((c) => [c.link.id, c.upstream.id])).toEqual([['l1', 'per_1']]);
    expect(staleOnNode(index, 'users').map((s) => s.item.id)).toEqual(['job_1']);
    expect(staleOnNode(index, 'scen')).toEqual([]);
  });

  it('ignores links into deleted upstreams (the live graph drops them)', () => {
    const gone = makeItem({ id: 'per_1', version: 3, deletedAt: T1 });
    expect(staleIndex(liveGraph([gone, p2, job], graph.links)).size).toBe(0);
  });
});

describe('bodyAtVersion', () => {
  const ev = (fromVersion: number, prevBody?: unknown): DecisionEvent => ({
    id: `evt_${fromVersion}`, projectId: PROJECT, itemId: 'per_1', kind: 'edited', fromVersion, toVersion: fromVersion + 1,
    actor: 'human', at: T1, ...(prevBody !== undefined ? { prevBody } : {}),
  });

  it('returns the body kept on the edit that left that version', () => {
    const events = [ev(1, personaBody('v1')), ev(2, personaBody('v2')), ev(3)];
    expect(bodyAtVersion(events, 'per_1', 2)).toEqual(personaBody('v2'));
    expect(bodyAtVersion(events, 'per_1', 3)).toBeUndefined();
    expect(bodyAtVersion(events, 'per_9', 1)).toBeUndefined();
  });
});

describe('run-level staleness', () => {
  const brief = makeItem({ id: 'brf_1', node: 'brief', type: 'brief', version: 2, body: { raw_text: 'r', fields: {} } });
  const runs = [
    run('run_new', 'USERS_JTBD', 'users', [{ itemId: 'brf_1', version: 1 }]),
    run('run_old', 'USERS_JTBD', 'users', [{ itemId: 'brf_1', version: 0 + 1 }]),
    run('run_fail', 'FOLLOW_UPS', 'users', [{ itemId: 'brf_1', version: 1 }], 'failed'),
    run('run_alt', 'ALT_SCAN', 'alt', [{ itemId: 'brf_1', version: 2 }]),
  ];

  it('looks only at the newest non-failed run per task on the node', () => {
    expect(latestRunsByTask(runs, 'users').map((r) => r.id)).toEqual(['run_new']);
    const stale = nodeRunStaleness(runs, [brief], 'users');
    expect(stale.map((s) => [s.run.id, s.changed])).toEqual([['run_new', [{ itemId: 'brf_1', seen: 1, current: 2 }]]]);
    expect(nodeRunStaleness(runs, [brief], 'alt')).toEqual([]);
  });

  it('fingerprints the changed inputs by id and current version', () => {
    const stale = nodeRunStaleness(runs, [brief], 'users');
    expect(changedInputsKey(stale)).toBe('brf_1@2');
    expect(changedInputsKey(nodeRunStaleness(runs, [], 'users'))).toBe('brf_1@x');
  });
});
