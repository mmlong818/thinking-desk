import { describe, expect, it } from 'vitest';
import {
  ACCEPT_RECOMMENDED_NOTE, planAcceptRecommended, planCreateItem, planItemUpdate,
} from './plan-item';
import { PREV_BODY_MAX_CHARS } from './events';
import { RepositoryError } from './repository';
import { briefBody, jobBody, makeItem, personaBody, PROJECT, seqIdSource, T1 } from './__fixtures__/model';

const ctx = () => ({ projectId: PROJECT, now: T1, idSource: seqIdSource() });
const human = { actor: 'human' as const };

describe('planCreateItem', () => {
  const persona = makeItem({ id: 'per_1', version: 4 });

  it('creates a human item, accepted by default, with created + accepted events', () => {
    const p = planCreateItem({ items: [persona], links: [] }, {
      node: 'users', type: 'job', body: jobBody(), links: [{ to: 'per_1', rel: 'derived_from' }],
    }, ctx());
    expect(p.item).toMatchObject({ id: 'job_00000001', origin: 'human', decision: 'accepted', version: 1, createdAt: T1 });
    expect(p.item).not.toHaveProperty('runId');
    expect(p.links).toMatchObject([{ from: 'job_00000001', to: 'per_1', toVersionSeen: 4 }]);
    expect(p.events.map((e) => [e.kind, e.actor, e.fromVersion, e.toVersion])).toEqual([
      ['created', 'human', 0, 1], ['accepted', 'human', 1, 1],
    ]);
  });

  it('can create a pending draft (single created event)', () => {
    const p = planCreateItem({ items: [], links: [] }, { node: 'users', type: 'persona', body: personaBody(), decision: 'pending' }, ctx());
    expect(p.events.map((e) => e.kind)).toEqual(['created']);
  });

  it('refuses links the type registry does not allow', () => {
    const p = () => planCreateItem({ items: [persona], links: [] }, {
      node: 'users', type: 'job', body: jobBody(), links: [{ to: 'per_1', rel: 'depends_on' }],
    }, ctx());
    expect(p).toThrow(/not an allowed link/);
  });

  it('rejects bad input', () => {
    const state = { items: [persona], links: [] };
    const expectCode = (fn: () => unknown, code: string) => {
      try { fn(); } catch (e) { expect(e).toBeInstanceOf(RepositoryError); expect((e as RepositoryError).code).toBe(code); return; }
      throw new Error('expected a RepositoryError');
    };
    expectCode(() => planCreateItem(state, { node: 'stake', type: 'persona', body: personaBody() }, ctx()), 'invalid');
    expectCode(() => planCreateItem(state, { node: 'users', type: 'persona', body: {} }, ctx()), 'invalid');
    expectCode(() => planCreateItem(state, {
      node: 'users', type: 'job', body: jobBody(), links: [{ to: 'missing', rel: 'serves' }],
    }, ctx()), 'invalid');
    const brief = makeItem({ id: 'brf_1', node: 'brief', type: 'brief', body: {} });
    expectCode(() => planCreateItem({ items: [brief], links: [] }, { node: 'brief', type: 'brief', body: { raw_text: 'r', fields: {} } }, ctx()), 'invalid');
  });

  it('refuses a second live singleton', () => {
    const brief = makeItem({ id: 'brf_1', node: 'brief', type: 'brief', body: {} });
    const input = { node: 'brief' as const, type: 'brief' as const, body: briefBody(null) };
    expect(() => planCreateItem({ items: [brief], links: [] }, input, ctx())).toThrow(/already has/);
  });
});

describe('planItemUpdate', () => {
  const item = makeItem({ id: 'per_1', version: 2, decision: 'accepted', decisionNote: 'fits' });

  it('a human body edit bumps the version, marks ai_edited and keeps the decision', () => {
    const p = planItemUpdate(item, { body: personaBody('Renamed') }, human, ctx());
    expect(p.item).toMatchObject({ version: 3, origin: 'ai_edited', decision: 'accepted', decisionNote: 'fits', updatedAt: T1 });
    expect(p.events.map((e) => [e.kind, e.fromVersion, e.toVersion])).toEqual([['edited', 2, 3]]);
  });

  it('an unchanged body is a no-op (no version bump, no event)', () => {
    const p = planItemUpdate(item, { body: personaBody() }, human, ctx());
    expect(p.item).toBe(item);
    expect(p.events).toEqual([]);
  });

  it('a decision change does not bump the version (links must not go stale)', () => {
    const p = planItemUpdate(item, { decision: 'rejected', decisionNote: 'duplicate of per_2' }, human, ctx());
    expect(p.item).toMatchObject({ version: 2, decision: 'rejected', decisionNote: 'duplicate of per_2' });
    expect(p.events.map((e) => [e.kind, e.fromVersion, e.toVersion, e.note])).toEqual([['rejected', 2, 2, 'duplicate of per_2']]);
  });

  it('a new decision without a note clears the old note; reset is the pending event', () => {
    const p = planItemUpdate(item, { decision: 'pending' }, human, ctx());
    expect(p.item).not.toHaveProperty('decisionNote');
    expect(p.events.map((e) => e.kind)).toEqual(['reset']);
  });

  it('changing only the note re-records the same decision', () => {
    const p = planItemUpdate(item, { decisionNote: 'fits the K12 segment' }, human, ctx());
    expect(p.events.map((e) => [e.kind, e.note])).toEqual([['accepted', 'fits the K12 segment']]);
    expect(planItemUpdate(item, { decisionNote: null }, human, ctx()).item).not.toHaveProperty('decisionNote');
  });

  it('edit + decision in one patch yields two ordered events', () => {
    const pending = makeItem({ id: 'per_2' });
    const p = planItemUpdate(pending, { body: personaBody('X'), decision: 'accepted' }, human, ctx());
    expect(p.item).toMatchObject({ version: 2, origin: 'ai_edited', decision: 'accepted' });
    expect(p.events.map((e) => [e.kind, e.fromVersion, e.toVersion])).toEqual([['edited', 1, 2], ['accepted', 2, 2]]);
  });

  it('an AI edit resets a judged item to pending', () => {
    const p = planItemUpdate(item, { body: personaBody('AI') }, { actor: 'ai' }, ctx());
    expect(p.item).toMatchObject({ version: 3, origin: 'ai', decision: 'pending' });
    expect(p.events.map((e) => e.kind)).toEqual(['edited', 'reset']);
  });

  it('soft-deletes, and refuses to touch a deleted item', () => {
    const p = planItemUpdate(item, { deleted: true }, { actor: 'human', note: 'out of scope' }, ctx());
    expect(p.item).toMatchObject({ deletedAt: T1, version: 2 });
    expect(p.events).toMatchObject([{ kind: 'deleted', note: 'out of scope' }]);
    expect(() => planItemUpdate(p.item, { decision: 'accepted' }, human, ctx())).toThrow(/deleted/);
  });

  it('validates the new body', () => {
    expect(() => planItemUpdate(item, { body: { name: 1 } }, human, ctx())).toThrow(RepositoryError);
  });

  it('keeps the previous body on a human edit, unless it is too large', () => {
    const p = planItemUpdate(item, { body: personaBody('v3') }, human, ctx());
    expect(p.events[0]).toMatchObject({ kind: 'edited', fromVersion: 2, toVersion: 3, prevBody: item.body });
    const huge = makeItem({ id: 'per_h', body: personaBody('x'.repeat(PREV_BODY_MAX_CHARS)) });
    expect(planItemUpdate(huge, { body: personaBody('short') }, human, ctx()).events[0]).not.toHaveProperty('prevBody');
  });

  it('replaces the evidence without a version bump: one evidence_updated event; identical evidence is a no-op', () => {
    const evidence = {
      basis: 'web' as const,
      sources: [{ title: 'Notion', url: 'https://www.notion.so/', verified: true, status: 'title_match' as const, checkedAt: T1 }],
    };
    const p = planItemUpdate(item, { evidence }, { actor: 'human', note: '核实来源' }, ctx());
    expect(p.item).toMatchObject({ version: 2, evidence });
    expect(p.events.map((e) => [e.kind, e.fromVersion, e.toVersion, e.note])).toEqual([['evidence_updated', 2, 2, '核实来源']]);
    expect(planItemUpdate(p.item, { evidence }, human, ctx()).events).toEqual([]);
    expect(() => planItemUpdate(item, { evidence: { basis: 'web', sources: [{ title: 1 }] } as never }, human, ctx())).toThrow(RepositoryError);
  });
});

describe('planAcceptRecommended', () => {
  const recommend = { verdict: 'recommend' as const, reason: 'core job' };
  const items = [
    makeItem({ id: 'per_r1', aiStance: recommend }),
    makeItem({ id: 'per_r2', aiStance: recommend, version: 3 }),
    makeItem({ id: 'per_n', aiStance: { verdict: 'neutral', reason: '' } }),
    makeItem({ id: 'per_done', aiStance: recommend, decision: 'rejected' }),
    makeItem({ id: 'per_gone', aiStance: recommend, deletedAt: T1 }),
    makeItem({ id: 'stk_other', node: 'stake', aiStance: recommend }),
    makeItem({
      id: 'fnd_1', type: 'finding', aiStance: recommend,
      body: { title: 't', description: 'd', severity: 'high', suggested_fix: 'f' },
    }),
  ];

  it('accepts only live pending recommended items on the node (never consistency findings), one human event each', () => {
    const p = planAcceptRecommended({ items, links: [] }, 'users', ctx());
    expect(p.items.map((i) => [i.id, i.decision, i.version, i.updatedAt])).toEqual([
      ['per_r1', 'accepted', 1, T1], ['per_r2', 'accepted', 3, T1],
    ]);
    expect(p.events.map((e) => [e.itemId, e.kind, e.actor, e.fromVersion, e.toVersion, e.note])).toEqual([
      ['per_r1', 'accepted', 'human', 1, 1, ACCEPT_RECOMMENDED_NOTE],
      ['per_r2', 'accepted', 'human', 3, 3, ACCEPT_RECOMMENDED_NOTE],
    ]);
    expect(new Set(p.events.map((e) => e.id)).size).toBe(2);
  });

  it('is a no-op when nothing qualifies', () => {
    expect(planAcceptRecommended({ items, links: [] }, 'alt', ctx())).toEqual({ items: [], events: [] });
  });
});
