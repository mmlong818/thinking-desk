import { describe, expect, it } from 'vitest';
import { NODES, type NodeKind } from '../../data/nodes';
import { completedNodes, completionCookieValue, isNodeComplete } from './completion';
import type { Item } from './item-types';
import type { ItemRecord, ItemType } from './types';
import { makeItem, T1 } from './__fixtures__/model';

let n = 0;
/** Bodies are irrelevant to completion, so a placeholder body is fine here. */
const item = (node: NodeKind, type: ItemType, extra: Partial<ItemRecord> = {}): Item =>
  makeItem({ id: `x_${++n}`, node, type, body: {}, decision: 'accepted', ...extra });

describe('isNodeComplete', () => {
  it('users needs an accepted persona AND an accepted job', () => {
    expect(isNodeComplete('users', [item('users', 'persona')])).toBe(false);
    expect(isNodeComplete('users', [item('users', 'persona'), item('users', 'job')])).toBe(true);
  });

  it('ignores pending, rejected and deleted items', () => {
    const items = [
      item('users', 'persona'),
      item('users', 'job', { decision: 'pending' }),
      item('users', 'job', { decision: 'rejected' }),
      item('users', 'job', { deletedAt: T1 }),
    ];
    expect(isNodeComplete('users', items)).toBe(false);
  });

  it('only counts items on the node itself (feature on feat does not complete final)', () => {
    expect(isNodeComplete('final', [item('feat', 'module'), item('feat', 'design_section')])).toBe(false);
    expect(isNodeComplete('final', [item('final', 'module'), item('final', 'design_section')])).toBe(true);
  });

  it('leap accepts any of the three leap types', () => {
    expect(isNodeComplete('leap', [item('leap', 'constraint_flip')])).toBe(true);
    expect(isNodeComplete('leap', [item('leap', 'critique')])).toBe(false);
  });

  it('every node has a rule that its own item types can satisfy', () => {
    for (const def of NODES) {
      const items = def.completion.map((c) => item(def.kind, c.anyOf[0]));
      expect(isNodeComplete(def.kind, items)).toBe(true);
    }
  });
});

describe('completedNodes / completionCookieValue', () => {
  it('derives the set and serialises it in NODES order', () => {
    const done = completedNodes([item('split', 'subtask'), item('brief', 'brief')]);
    expect(done).toEqual(new Set(['brief', 'split']));
    expect(completionCookieValue(done)).toBe('brief,split');
    expect(completionCookieValue(new Set())).toBe('');
  });
});
