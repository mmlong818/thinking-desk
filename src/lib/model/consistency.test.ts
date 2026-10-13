import { describe, expect, it } from 'vitest';
import { validFeature } from '../ai/schemas/__fixtures__/draft-features';
import { findingsOnNode, ruleFindings } from './consistency';
import { indexById, liveGraph } from './graph';
import type { Item } from './item-types';
import type { Link, LinkRel } from './types';
import { jobBody, makeItem, PROJECT, T1 } from './__fixtures__/model';

const { id: _id, traces: _t, ...featureBody } = validFeature(1);
const feature = (id: string, extra: Partial<Item> = {}, body: Record<string, unknown> = {}) =>
  makeItem({ id, node: 'final', type: 'feature', decision: 'accepted', body: { ...featureBody, name: id, ...body }, ...extra });
const job = (id: string, decision: Item['decision'] = 'accepted') =>
  makeItem({ id, type: 'job', decision, body: jobBody(id) });
const moduleItem = (id: string) =>
  makeItem({ id, node: 'final', type: 'module', decision: 'accepted', body: { name: id, responsibility: 'r', key_screens: [] } });
const subtask = (id: string, decision: Item['decision'] = 'accepted') => makeItem({
  id, node: 'split', type: 'subtask', decision,
  body: { title: id, description: 'd', layer: 'backend', estimate: '1d', acceptance_criteria: [], critical: false },
});
const findingItem = (id: string, decision: Item['decision']) => makeItem({
  id, node: 'final', type: 'finding', decision, body: { title: id, description: 'd', severity: 'high', suggested_fix: 'f' },
});
let n = 0;
const link = (from: string, to: string, rel: LinkRel): Link => ({ id: `l${++n}`, projectId: PROJECT, from, to, rel, toVersionSeen: 1 });

const codes = (items: Item[], links: Link[]) => ruleFindings(liveGraph(items, links)).map((f) => [f.code, f.itemIds]);

describe('ruleFindings', () => {
  it('flags accepted features that serve no accepted job', () => {
    const items = [feature('ftr_ok'), feature('ftr_none'), feature('ftr_rej_job'), job('job_a'), job('job_r', 'rejected')];
    const links = [link('ftr_ok', 'job_a', 'serves'), link('ftr_rej_job', 'job_r', 'serves')];
    expect(codes(items, links).filter(([c]) => c === 'feature.no_job')).toEqual([
      ['feature.no_job', ['ftr_none']], ['feature.no_job', ['ftr_rej_job']],
    ]);
  });

  it('flags modules without an accepted feature and subtasks without an accepted feature or module', () => {
    const items = [
      feature('ftr_a'), job('job_a'), moduleItem('mod_ok'), moduleItem('mod_none'),
      subtask('tsk_feat'), subtask('tsk_mod'), subtask('tsk_none'), subtask('tsk_pending', 'pending'),
    ];
    const links = [
      link('ftr_a', 'job_a', 'serves'), link('mod_ok', 'ftr_a', 'implements'),
      link('tsk_feat', 'ftr_a', 'implements'), link('tsk_mod', 'mod_ok', 'derived_from'),
    ];
    expect(codes(items, links)).toEqual([
      ['module.no_feature', ['mod_none']],
      ['subtask.no_target', ['tsk_none']],
    ]);
  });

  it('flags final features no accepted subtask reaches, once any subtask is accepted', () => {
    const items = [
      feature('ftr_direct'), feature('ftr_via_mod'), feature('ftr_none'), feature('ftr_draft', { node: 'feat' }),
      job('job_a'), moduleItem('mod_a'), subtask('tsk_a'), subtask('tsk_b'), subtask('tsk_p', 'pending'),
    ];
    const links = [
      ...['ftr_direct', 'ftr_via_mod', 'ftr_none', 'ftr_draft'].map((f) => link(f, 'job_a', 'serves')),
      link('tsk_a', 'ftr_direct', 'implements'), link('mod_a', 'ftr_via_mod', 'implements'),
      link('tsk_b', 'mod_a', 'derived_from'), link('tsk_p', 'ftr_none', 'implements'),
    ];
    expect(codes(items, links)).toEqual([['feature.no_subtask', ['ftr_none']]]);
    expect(codes([feature('ftr_none'), job('job_a')], [link('ftr_none', 'job_a', 'serves')])).toEqual([]);
  });

  it('flags accepted features the AI marked as touching a red line', () => {
    const items = [feature('ftr_red', {}, { red_line_risk: true, ethics_concern: '公开排名' }), job('job_a')];
    const found = ruleFindings(liveGraph(items, [link('ftr_red', 'job_a', 'serves')]));
    expect(found).toMatchObject([{ code: 'feature.red_line_risk', node: 'final', itemIds: ['ftr_red'] }]);
    expect(found[0].message).toContain('公开排名');
  });

  it('flags a confirmed finding whose involved items are all still accepted', () => {
    const items = [
      findingItem('fnd_open', 'accepted'), findingItem('fnd_fixed', 'accepted'), findingItem('fnd_pending', 'pending'),
      feature('ftr_a'), feature('ftr_b', { decision: 'rejected' }), job('job_a'),
    ];
    const links = [
      link('ftr_a', 'job_a', 'serves'),
      link('fnd_open', 'ftr_a', 'conflicts_with'), link('fnd_open', 'job_a', 'conflicts_with'),
      link('fnd_fixed', 'ftr_a', 'conflicts_with'), link('fnd_fixed', 'ftr_b', 'conflicts_with'),
      link('fnd_pending', 'ftr_a', 'conflicts_with'),
    ];
    expect(codes(items, links)).toEqual([['finding.unresolved', ['fnd_open', 'ftr_a', 'job_a']]]);
  });

  it('flags accepted items that depend on a rejected item, and ignores deleted ones', () => {
    const items = [
      subtask('tsk_a'), subtask('tsk_rej', 'rejected'), feature('ftr_a'), job('job_a'),
      makeItem({ ...subtask('tsk_gone'), deletedAt: T1 }),
    ];
    const links = [
      link('ftr_a', 'job_a', 'serves'), link('tsk_a', 'ftr_a', 'implements'),
      link('tsk_a', 'tsk_rej', 'depends_on'), link('tsk_a', 'tsk_gone', 'depends_on'),
    ];
    expect(codes(items, links)).toEqual([['link.to_rejected', ['tsk_a', 'tsk_rej']]]);
  });

  it('is silent for pending and rejected items, and sorts by node order', () => {
    const items = [subtask('tsk_none'), feature('ftr_none'), feature('ftr_p', { decision: 'pending' })];
    expect(ruleFindings(liveGraph(items, [])).map((f) => [f.node, f.code])).toEqual([
      ['final', 'feature.no_job'], ['final', 'feature.no_subtask'], ['split', 'subtask.no_target'],
    ]);
  });
});

describe('findingsOnNode', () => {
  it('matches a finding by any involved item', () => {
    const items = [subtask('tsk_a'), subtask('tsk_rej', 'rejected'), feature('ftr_a'), job('job_a')];
    const links = [link('ftr_a', 'job_a', 'serves'), link('tsk_a', 'ftr_a', 'implements'), link('tsk_a', 'tsk_rej', 'depends_on')];
    const all = ruleFindings(liveGraph(items, links));
    const byId = indexById(items);
    expect(findingsOnNode(all, 'split', byId)).toHaveLength(1);
    expect(findingsOnNode(all, 'users', byId)).toEqual([]);
  });
});
