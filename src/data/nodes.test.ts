import { describe, expect, it } from 'vitest';
import {
  NODES,
  formatNodeNum,
  getNode,
  isNodeLocked,
  missingDeps,
  nextNodeKind,
  prevNodeKind,
  type NodeKind,
} from './nodes';

const ALL_KINDS = NODES.map((n) => n.kind);

describe('NODES graph', () => {
  it('has 9 nodes with unique kinds and sequential nums', () => {
    expect(NODES).toHaveLength(9);
    expect(new Set(ALL_KINDS).size).toBe(NODES.length);
    expect(NODES.map((n) => n.num)).toEqual(['01', '02', '03', '04', '05', '06', '07', '08', '09']);
  });

  it('every dep is a valid NodeKind and not a self-reference', () => {
    const valid = new Set<string>(ALL_KINDS);
    for (const node of NODES) {
      for (const dep of node.deps) {
        expect(valid.has(dep), `${node.kind} -> ${dep}`).toBe(true);
        expect(dep).not.toBe(node.kind);
      }
    }
  });

  it('is acyclic (every node reaches a root by following deps)', () => {
    const state = new Map<NodeKind, 'visiting' | 'done'>();
    const visit = (kind: NodeKind): void => {
      const s = state.get(kind);
      if (s === 'done') return;
      expect(s, `cycle at ${kind}`).not.toBe('visiting');
      state.set(kind, 'visiting');
      for (const dep of getNode(kind)!.deps) visit(dep);
      state.set(kind, 'done');
    };
    ALL_KINDS.forEach(visit);
    expect(state.size).toBe(NODES.length);
  });

  it('matches the documented dependency graph', () => {
    const deps = Object.fromEntries(NODES.map((n) => [n.kind, [...n.deps]]));
    expect(deps).toEqual({
      brief: [],
      users: ['brief'],
      stake: ['brief'],
      alt: ['brief'],
      scen: ['brief'],
      feat: ['brief'],
      leap: ['feat'],
      final: ['feat'],
      split: ['final'],
    });
  });
});

describe('missingDeps / isNodeLocked', () => {
  it('root node is never locked', () => {
    expect(missingDeps('brief', new Set())).toEqual([]);
    expect(isNodeLocked('brief', new Set())).toBe(false);
  });

  it('locks a node until all its deps are completed', () => {
    expect(missingDeps('users', new Set())).toEqual(['brief']);
    expect(isNodeLocked('users', new Set())).toBe(true);
    expect(isNodeLocked('users', new Set<NodeKind>(['brief']))).toBe(false);
  });

  it('does not treat transitive ancestors as satisfying a direct dep', () => {
    // split depends on final only; brief + feat done is not enough
    const done = new Set<NodeKind>(['brief', 'feat']);
    expect(missingDeps('split', done)).toEqual(['final']);
    expect(isNodeLocked('split', done)).toBe(true);
    expect(isNodeLocked('split', new Set<NodeKind>([...done, 'final']))).toBe(false);
  });

  it('ignores unrelated completed nodes', () => {
    expect(isNodeLocked('leap', new Set<NodeKind>(['brief', 'users', 'stake']))).toBe(true);
  });

  it('returns [] for an unknown kind', () => {
    expect(missingDeps('nope' as NodeKind, new Set())).toEqual([]);
  });
});

describe('formatNodeNum', () => {
  it('formats "NODE · NN / TT" from NODES length', () => {
    expect(formatNodeNum('brief')).toBe('NODE · 01 / 09');
    expect(formatNodeNum('final')).toBe('NODE · 08 / 09');
    expect(formatNodeNum('split')).toBe('NODE · 09 / 09');
  });

  it('falls back to ?? for an unknown kind', () => {
    expect(formatNodeNum('nope' as NodeKind)).toBe('NODE · ?? / 09');
  });
});

describe('next / prev navigation', () => {
  it('walks the NODES order and stops at the ends', () => {
    expect(prevNodeKind('brief')).toBeNull();
    expect(nextNodeKind('brief')).toBe('users');
    expect(prevNodeKind('users')).toBe('brief');
    expect(nextNodeKind('split')).toBeNull();
  });
});
