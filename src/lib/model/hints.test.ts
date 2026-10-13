import { describe, expect, it } from 'vitest';
import type { NodeKind } from '../../data/nodes';
import { nodeHints, projectHints } from './hints';
import type { Item } from './item-types';
import type { ItemRecord, ItemType } from './types';
import { briefBody, jobBody, makeItem, T1 } from './__fixtures__/model';

let n = 0;
const item = (node: NodeKind, type: ItemType, body: unknown, extra: Partial<ItemRecord> = {}): Item =>
  makeItem({ id: `x_${++n}`, node, type, body, decision: 'accepted', ...extra });

const stakeholder = (category: string, extra: Partial<ItemRecord> = {}) => item('stake', 'stakeholder', {
  name: 'n', role: 'r', power: 'high', interest: 'high', note: '', source: '', required: true, category,
  engagement_hint: '',
}, extra);

const codes = (kind: NodeKind, items: Item[]) => nodeHints(kind, items).map((h) => h.code);

describe('nodeHints', () => {
  it('is silent for a node that has not started', () => {
    expect(nodeHints('brief', [])).toEqual([]);
  });

  it('brief: asks for an accepted red line and a success criterion', () => {
    const brief = item('brief', 'brief', briefBody());
    expect(codes('brief', [brief])).toEqual(['brief.no_red_line', 'brief.no_success_criteria']);
    const done = item('brief', 'brief', { ...briefBody(), fields: { ...briefBody().fields, success_criteria: '留存 40%' } });
    expect(codes('brief', [done, item('brief', 'red_line', { text: '不收集未成年人生物信息' })])).toEqual([]);
  });

  it('only counts accepted, live items', () => {
    const brief = item('brief', 'brief', briefBody());
    const pendingRedLine = item('brief', 'red_line', { text: 'x' }, { decision: 'pending' });
    const deletedRedLine = item('brief', 'red_line', { text: 'y' }, { deletedAt: T1 });
    expect(codes('brief', [brief, pendingRedLine, deletedRedLine])).toContain('brief.no_red_line');
  });

  it('stake: lists each missing baseline stakeholder category', () => {
    const hints = nodeHints('stake', [stakeholder('sponsor'), stakeholder('maker'), stakeholder('user', { decision: 'rejected' })]);
    expect(hints.map((h) => h.params?.category)).toEqual(['business', 'compliance', 'user']);
    expect(hints.every((h) => h.code === 'stake.missing_baseline' && h.node === 'stake')).toBe(true);
  });

  it('users: asks for an emotional job', () => {
    expect(codes('users', [item('users', 'job', jobBody())])).toEqual(['users.no_emotional_job']);
    expect(codes('users', [item('users', 'job', { ...jobBody(), dimension: 'emotional' })])).toEqual([]);
  });

  it('never blocks: hints are independent of completion', () => {
    const items = [item('feat', 'feature', {})];
    expect(codes('feat', items)).toEqual(['feat.no_not_doing']);
  });
});

describe('projectHints', () => {
  it('groups hints by node and omits nodes without any', () => {
    const hints = projectHints([item('scen', 'scenario', {}), item('split', 'subtask', {})]);
    expect(Object.keys(hints)).toEqual(['scen']);
    expect(hints.scen?.map((h) => h.code)).toEqual(['scen.no_hostile']);
  });
});
