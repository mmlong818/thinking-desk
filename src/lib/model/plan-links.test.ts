import { describe, expect, it } from 'vitest';
import { createsCycle, linkAllowed, LINK_RULES } from './link-rules';
import { planEditLinks, planRefreshLinks } from './plan-links';
import { RepositoryError } from './repository';
import type { Link } from './types';
import { jobBody, makeItem, PROJECT, seqIdSource, T1 } from './__fixtures__/model';

const ctx = () => ({ projectId: PROJECT, now: T1, idSource: seqIdSource() });
const human = { actor: 'human' as const };

const subtask = (id: string, version = 1) => makeItem({
  id, node: 'split', type: 'subtask', version,
  body: { title: id, description: 'd', layer: 'backend', estimate: '1d', acceptance_criteria: [], critical: false },
});
const feature = (id: string, node: 'feat' | 'final' = 'final', version = 1) => makeItem({
  id, node, type: 'feature', version,
  body: {
    name: id, description: 'd', pillar: 'p', group: '', kano: 'must', rice: { reach: 1, impact: 1, confidence: 1, effort: 1 },
    rice_score: 1, five_questions: { why_do: '', why_this_way: '', alternatives: '', what_if_not: '', what_if_wrong: '' },
    core_hypothesis: '', validation_metric: '', failure_signal: '', ethics_concern: '', red_line_risk: false,
  },
});
const moduleItem = (id: string) => makeItem({
  id, node: 'final', type: 'module', body: { name: id, responsibility: 'r', key_screens: [] },
});
const link = (id: string, from: string, to: string, rel: Link['rel'] = 'depends_on', toVersionSeen = 1): Link => ({
  id, projectId: PROJECT, from, to, rel, toVersionSeen,
});

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof RepositoryError ? e.code : 'other';
  }
  return undefined;
}

describe('link rules', () => {
  it('come from the type registry plus the adapter-supplied links', () => {
    expect(linkAllowed({ type: 'subtask', node: 'split' }, 'depends_on', { type: 'subtask', node: 'split' })).toBe(true);
    expect(linkAllowed({ type: 'subtask', node: 'split' }, 'implements', { type: 'feature', node: 'final' })).toBe(true);
    expect(linkAllowed({ type: 'module', node: 'final' }, 'implements', { type: 'feature', node: 'final' })).toBe(true);
    expect(linkAllowed({ type: 'brief', node: 'brief' }, 'assumes', { type: 'assumption', node: 'brief' })).toBe(true);
    expect(linkAllowed({ type: 'finding', node: 'final' }, 'conflicts_with', { type: 'red_line', node: 'brief' })).toBe(true);
  });

  it('refuse other pairs and respect node pins', () => {
    expect(linkAllowed({ type: 'subtask', node: 'split' }, 'serves', { type: 'job', node: 'users' })).toBe(false);
    expect(linkAllowed({ type: 'module', node: 'final' }, 'implements', { type: 'subtask', node: 'split' })).toBe(false);
    expect(linkAllowed({ type: 'feature', node: 'final' }, 'derived_from', { type: 'feature', node: 'feat' })).toBe(true);
    expect(linkAllowed({ type: 'feature', node: 'feat' }, 'derived_from', { type: 'feature', node: 'final' })).toBe(false);
    expect(linkAllowed({ type: 'revision', node: 'final' }, 'derived_from', { type: 'feature', node: 'final' })).toBe(true);
    expect(LINK_RULES.length).toBeGreaterThan(20);
  });

  it('detect depends_on cycles, including through other items', () => {
    const links = [link('l1', 'a', 'b'), link('l2', 'b', 'c'), link('l3', 'x', 'a', 'implements')];
    expect(createsCycle(links, 'c', 'a')).toBe(true);
    expect(createsCycle(links, 'a', 'c')).toBe(false);
    expect(createsCycle(links, 'a', 'x')).toBe(false);
    expect(createsCycle(links, 'a', 'a')).toBe(true);
  });
});

describe('planEditLinks', () => {
  const items = [subtask('tsk_a', 2), subtask('tsk_b', 3), subtask('tsk_c'), feature('ftr_f', 'final', 4), moduleItem('mod_m')];
  const links = [link('lnk_ab', 'tsk_a', 'tsk_b', 'depends_on', 3)];

  it('adds links seen at the target version, with one link_added event on the from item each', () => {
    const plan = planEditLinks({ items, links }, {
      add: [{ from: 'tsk_b', to: 'tsk_c', rel: 'depends_on' }, { from: 'mod_m', to: 'ftr_f', rel: 'implements' }],
    }, { ...human, note: 'by hand' }, ctx());
    expect(plan.added.map((l) => [l.from, l.to, l.rel, l.toVersionSeen])).toEqual([
      ['tsk_b', 'tsk_c', 'depends_on', 1], ['mod_m', 'ftr_f', 'implements', 4],
    ]);
    expect(plan.events.map((e) => [e.kind, e.itemId, e.fromVersion, e.toVersion, e.link?.to, e.note])).toEqual([
      ['link_added', 'tsk_b', 3, 3, 'tsk_c', 'by hand'], ['link_added', 'mod_m', 1, 1, 'ftr_f', 'by hand'],
    ]);
    expect(plan.events[0].link).toEqual({ id: plan.added[0].id, to: 'tsk_c', rel: 'depends_on' });
  });

  it('removes before it adds, so a link can be moved in one edit; removal records link_removed', () => {
    const plan = planEditLinks({ items, links }, {
      remove: ['lnk_ab'], add: [{ from: 'tsk_b', to: 'tsk_a', rel: 'depends_on' }],
    }, human, ctx());
    expect(plan.removed.map((l) => l.id)).toEqual(['lnk_ab']);
    expect(plan.added.map((l) => [l.from, l.to])).toEqual([['tsk_b', 'tsk_a']]);
    expect(plan.events.map((e) => [e.kind, e.itemId, e.link?.id])).toEqual([
      ['link_removed', 'tsk_a', 'lnk_ab'], ['link_added', 'tsk_b', plan.added[0].id],
    ]);
  });

  it('is idempotent for an existing (from, to, rel)', () => {
    const plan = planEditLinks({ items, links }, { add: [{ from: 'tsk_a', to: 'tsk_b', rel: 'depends_on' }] }, human, ctx());
    expect(plan).toEqual({ added: [], removed: [], events: [] });
  });

  it('refuses a dependency cycle (conflict), self-links and pairs the registry does not allow (invalid)', () => {
    expect(codeOf(() => planEditLinks({ items, links }, { add: [{ from: 'tsk_b', to: 'tsk_a', rel: 'depends_on' }] }, human, ctx()))).toBe('conflict');
    expect(codeOf(() => planEditLinks({ items, links }, { add: [{ from: 'tsk_a', to: 'tsk_a', rel: 'depends_on' }] }, human, ctx()))).toBe('invalid');
    expect(codeOf(() => planEditLinks({ items, links }, { add: [{ from: 'tsk_a', to: 'ftr_f', rel: 'depends_on' }] }, human, ctx()))).toBe('invalid');
    expect(codeOf(() => planEditLinks({ items, links }, { add: [{ from: 'ftr_f', to: 'tsk_a', rel: 'implements' }] }, human, ctx()))).toBe('invalid');
  });

  it('refuses unknown or deleted items and unknown link ids (not_found)', () => {
    const gone = [...items, makeItem({ ...subtask('tsk_gone'), deletedAt: T1 })];
    expect(codeOf(() => planEditLinks({ items: gone, links }, { add: [{ from: 'tsk_a', to: 'tsk_gone', rel: 'depends_on' }] }, human, ctx()))).toBe('not_found');
    expect(codeOf(() => planEditLinks({ items, links }, { add: [{ from: 'nope', to: 'tsk_a', rel: 'depends_on' }] }, human, ctx()))).toBe('not_found');
    expect(codeOf(() => planEditLinks({ items, links }, { remove: ['lnk_nope'] }, human, ctx()))).toBe('not_found');
  });

  it('checks cycles against the links added earlier in the same edit', () => {
    const edit = { add: [{ from: 'tsk_b', to: 'tsk_c', rel: 'depends_on' as const }, { from: 'tsk_c', to: 'tsk_a', rel: 'depends_on' as const }] };
    expect(codeOf(() => planEditLinks({ items, links }, edit, human, ctx()))).toBe('conflict');
  });
});

describe('planRefreshLinks', () => {
  const to = makeItem({ id: 'per_1', version: 5 });
  const from = makeItem({ id: 'job_1', type: 'job', body: jobBody(), version: 2 });
  const stale = link('lnk_1', 'job_1', 'per_1', 'derived_from', 2);
  const fresh = link('lnk_2', 'job_1', 'per_1', 'serves', 5);

  it('sets toVersionSeen to the current upstream version, one link_confirmed event per link that moved', () => {
    const plan = planRefreshLinks({ items: [to, from], links: [stale, fresh] }, ['lnk_1', 'lnk_2'], human, ctx());
    expect(plan.links).toEqual([{ ...stale, toVersionSeen: 5 }, fresh]);
    expect(plan.changed).toEqual([{ ...stale, toVersionSeen: 5 }]);
    expect(plan.events.map((e) => [e.kind, e.itemId, e.fromVersion, e.link])).toEqual([
      ['link_confirmed', 'job_1', 2, { id: 'lnk_1', to: 'per_1', rel: 'derived_from' }],
    ]);
  });

  it('rejects unknown links and links to deleted items', () => {
    expect(() => planRefreshLinks({ items: [to, from], links: [stale] }, ['nope'], human, ctx())).toThrow(/not found/);
    const gone = makeItem({ id: 'per_1', version: 5, deletedAt: T1 });
    expect(() => planRefreshLinks({ items: [gone, from], links: [stale] }, ['lnk_1'], human, ctx())).toThrow(/deleted/);
  });
});
