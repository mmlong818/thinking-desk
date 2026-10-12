import { describe, expect, it } from 'vitest';
import { validFeature } from '../ai/tasks/__fixtures__/draft-features';
import { validLeap } from '../ai/tasks/__fixtures__/creative-leap';
import { isStale } from './graph';
import { planRunOutput, type PlanState } from './plan-run';
import { RepositoryError, type ItemDraft } from './repository';
import type { Link } from './types';
import {
  briefBody, jobBody, makeItem, output, personaBody, PROJECT, rawJob, rawPersona, runInput, seqIdSource, T1,
} from './__fixtures__/model';

const ctx = () => ({ projectId: PROJECT, now: T1, idSource: seqIdSource() });
const empty: PlanState = { items: [], links: [] };
const persona = (ref: string, name = 'P'): ItemDraft => ({ ref, type: 'persona', body: rawPersona(ref, name) });
const job = (ref: string, personaIds: string[] = []): ItemDraft => ({ ref, type: 'job', body: rawJob(ref, personaIds) });

describe('planRunOutput · temp ids → permanent ids + links', () => {
  const plan = planRunOutput(
    empty,
    output({
      drafts: [persona('p1'), persona('p2'), job('j1', ['p1']), job('j2', ['p1', 'p2', 'p1', 'zzz'])],
      replace: [{ node: 'users', type: 'persona' }, { node: 'users', type: 'job' }],
    }),
    ctx(),
  );

  it('records the run and creates AI-pending items with typed permanent ids', () => {
    expect(plan.run).toMatchObject({ id: 'run_00000001', projectId: PROJECT, createdAt: T1, status: 'ok' });
    expect(plan.created.map((i) => i.id)).toEqual(['per_00000002', 'per_00000003', 'job_00000004', 'job_00000005']);
    for (const i of plan.created) {
      expect(i).toMatchObject({ origin: 'ai', decision: 'pending', version: 1, runId: plan.run.id, node: 'users' });
    }
    expect(plan.created[2].body).toEqual(jobBody());
  });

  it('maps every temp id and turns cross-refs into deduplicated links', () => {
    expect(plan.idMap).toEqual({
      'persona:p1': 'per_00000002', 'persona:p2': 'per_00000003',
      'job:j1': 'job_00000004', 'job:j2': 'job_00000005',
    });
    expect(plan.linksAdded.map((l) => [l.from, l.to, l.rel, l.toVersionSeen])).toEqual([
      ['job_00000004', 'per_00000002', 'derived_from', 1],
      ['job_00000005', 'per_00000002', 'derived_from', 1],
      ['job_00000005', 'per_00000003', 'derived_from', 1],
    ]);
  });

  it('reports refs it cannot resolve instead of failing the run', () => {
    expect(plan.issues).toEqual([{ kind: 'unresolved_ref', index: 3, type: 'job', path: 'persona_ids', value: 'zzz' }]);
  });

  it('appends one created event per item, attributed to the AI', () => {
    expect(plan.events.map((e) => [e.itemId, e.kind, e.fromVersion, e.toVersion, e.actor])).toEqual(
      plan.created.map((i) => [i.id, 'created', 0, 1, 'ai']),
    );
  });
});

describe('planRunOutput · ref resolution', () => {
  it('scopes temp ids per type, so a persona and a job may share "a"', () => {
    const plan = planRunOutput(empty, output({ drafts: [persona('a'), job('a', ['a'])] }), ctx());
    expect(plan.linksAdded).toHaveLength(1);
    expect(plan.linksAdded[0]).toMatchObject({ from: plan.idMap['job:a'], to: plan.idMap['persona:a'] });
  });

  it('resolves refs to existing items by permanent id and records the version the AI saw', () => {
    const existing = makeItem({ id: 'per_x', version: 3, decision: 'accepted' });
    const state = { items: [existing], links: [] };
    const seen = planRunOutput(
      state, output({ run: runInput({ inputs: [{ itemId: 'per_x', version: 2 }] }), drafts: [job('j1', ['per_x'])] }), ctx(),
    );
    expect(seen.linksAdded[0]).toMatchObject({ to: 'per_x', toVersionSeen: 2 });
    expect(isStale(seen.linksAdded[0], [existing])).toBe(true);
    const unseen = planRunOutput(state, output({ drafts: [job('j1', ['per_x'])] }), ctx());
    expect(unseen.linksAdded[0].toVersionSeen).toBe(3);
  });

  it('honours node-filtered refs when a revised feature reuses the original id', () => {
    const original = makeItem({ id: 'ftr_old', node: 'feat', type: 'feature', body: validFeature(1), decision: 'accepted' });
    const leap = makeItem({ id: 'ana_1', node: 'leap', type: 'analogy', body: validLeap.analogies[0], decision: 'accepted' });
    const plan = planRunOutput(
      { items: [original, leap], links: [] },
      output({
        run: runInput({ task: 'FEAT_DRAFT', node: 'final' }),
        drafts: [
          { ref: 'ftr_old', type: 'feature', body: { ...validFeature(1), id: 'ftr_old' } },
          {
            type: 'revision',
            body: { action: 'modified', feature_id: 'ftr_old', original_feature_id: 'ftr_old', source_leap_ids: ['ana_1'], reason: 'r' },
          },
        ],
      }),
      ctx(),
    );
    const revised = plan.created.find((i) => i.type === 'feature');
    const revision = plan.created.find((i) => i.type === 'revision');
    expect(revised?.id).not.toBe('ftr_old');
    expect(revised?.node).toBe('final');
    expect(plan.linksAdded.filter((l) => l.from === revision?.id).map((l) => l.to)).toEqual([revised?.id, 'ftr_old', 'ana_1']);
  });

  it('adds explicit lineage links supplied by the adapter', () => {
    const original = makeItem({ id: 'ftr_old', node: 'feat', type: 'feature', body: validFeature(1) });
    const plan = planRunOutput(
      { items: [original], links: [] },
      output({
        run: runInput({ task: 'FEAT_DRAFT', node: 'final' }),
        drafts: [{
          ref: 'ftr_old', type: 'feature', body: validFeature(1),
          links: [{ ref: 'ftr_old', rel: 'derived_from', to: ['feature'], node: 'feat' }],
        }],
      }),
      ctx(),
    );
    expect(plan.linksAdded).toMatchObject([{ from: plan.created[0].id, to: 'ftr_old', rel: 'derived_from' }]);
  });

  it('keeps the first of duplicated temp ids and reports the duplicate', () => {
    const plan = planRunOutput(empty, output({ drafts: [persona('p1', 'A'), persona('p1', 'B'), job('j', ['p1'])] }), ctx());
    expect(plan.created).toHaveLength(3);
    expect(plan.issues).toEqual([{ kind: 'duplicate_ref', index: 1, type: 'persona', ref: 'p1' }]);
    expect(plan.linksAdded[0].to).toBe(plan.created[0].id);
  });

  it('skips drafts with an invalid body or a node the type cannot live on', () => {
    const plan = planRunOutput(
      empty,
      output({ drafts: [{ type: 'persona', body: { name: 1 } }, { type: 'stakeholder', body: {} }, persona('ok')] }),
      ctx(),
    );
    expect(plan.created.map((i) => i.type)).toEqual(['persona']);
    expect(plan.issues.map((i) => i.kind)).toEqual(['invalid_body', 'node_not_allowed']);
  });
});

describe('planRunOutput · regeneration semantics', () => {
  const accepted = makeItem({ id: 'per_a', decision: 'accepted' });
  const rejected = makeItem({ id: 'per_b', decision: 'rejected', decisionNote: 'too generic' });
  const pending = makeItem({ id: 'per_c' });
  const human = makeItem({ id: 'per_d', origin: 'human' });
  const edited = makeItem({ id: 'per_e', origin: 'ai_edited' });
  const echoed = makeItem({ id: 'per_f' });
  const otherScope = makeItem({ id: 'job_z', type: 'job', body: jobBody() });
  const link: Link = { id: 'lnk_1', projectId: PROJECT, from: 'job_z', to: 'per_c', rel: 'derived_from', toVersionSeen: 1 };
  const state: PlanState = { items: [accepted, rejected, pending, human, edited, echoed, otherScope], links: [link] };

  const plan = planRunOutput(
    state,
    output({
      drafts: [
        { ref: 'per_f', type: 'persona', body: rawPersona('per_f', 'F v2') },
        persona('p9'),
        { ref: 'per_a', type: 'persona', body: rawPersona('per_a', 'rewritten by AI') },
        job('j1', ['per_a', 'per_c']),
      ],
      replace: [{ node: 'users', type: 'persona' }],
    }),
    ctx(),
  );

  it('retires only untouched AI-pending items in the replaced scope', () => {
    expect(plan.retired.map((i) => i.id)).toEqual(['per_c']);
    expect(plan.retired[0]).toMatchObject({ deletedAt: T1, updatedAt: T1 });
    expect(plan.events.filter((e) => e.kind === 'deleted')).toMatchObject([
      { itemId: 'per_c', actor: 'ai', note: `superseded by run ${plan.run.id}` },
    ]);
  });

  it('removes links touching retired items and drops new refs to them', () => {
    expect(plan.linksRemoved).toEqual(['lnk_1']);
    expect(plan.linksAdded.map((l) => l.to)).toEqual(['per_a']);
    expect(plan.issues).toEqual([{ kind: 'unresolved_ref', index: 3, type: 'job', path: 'persona_ids', value: 'per_c' }]);
  });

  it('rewrites an echoed AI-pending item in place with a new version', () => {
    expect(plan.updated.map((i) => [i.id, i.version, (i.body as { name: string }).name])).toEqual([['per_f', 2, 'F v2']]);
    expect(plan.events.find((e) => e.itemId === 'per_f')).toMatchObject({ kind: 'edited', fromVersion: 1, toVersion: 2 });
  });

  it('never rewrites a judged item the AI echoed', () => {
    expect(plan.updated.find((i) => i.id === 'per_a')).toBeUndefined();
    expect(plan.events.some((e) => e.itemId === 'per_a')).toBe(false);
    expect(plan.idMap['persona:per_a']).toBe('per_a');
  });

  it('leaves out-of-scope items alone and adds the new ones', () => {
    expect(plan.created.map((i) => i.type)).toEqual(['persona', 'job']);
    expect(plan.retired.some((i) => i.id === 'job_z')).toBe(false);
  });

  it('is additive when the replace scope is empty ("give me 3 more")', () => {
    const more = planRunOutput(state, output({ drafts: [persona('p10')], replace: [] }), ctx());
    expect(more.retired).toEqual([]);
    expect(more.created).toHaveLength(1);
  });

  it('records a failed run without touching any item', () => {
    const failed = planRunOutput(state, output({
      run: runInput({ status: 'failed', error: 'timeout' }),
      drafts: [persona('p1')],
      replace: [{ node: 'users', type: 'persona' }],
    }), ctx());
    expect(failed.run).toMatchObject({ status: 'failed', error: 'timeout' });
    expect([failed.created, failed.updated, failed.retired, failed.events, failed.linksAdded])
      .toEqual([[], [], [], [], []]);
  });
});

describe('planRunOutput · singletons', () => {
  const defaults = { highlights: [], follow_ups: [], completeness: 0, answers: [], follow_up_answers: {} };
  const brief = makeItem({
    id: 'brf_1', node: 'brief', type: 'brief', body: { ...briefBody('v1'), ...defaults },
    version: 2, origin: 'ai_edited', decision: 'accepted', decisionNote: 'ok',
  });
  const run = runInput({ task: 'BRIEF_EXTRACT', node: 'brief' });
  const state = { items: [brief], links: [] };

  it('updates the live singleton in place, back to AI-pending, keeping its id', () => {
    const plan = planRunOutput(state, output({ run, drafts: [{ type: 'brief', body: briefBody('v2') }] }), ctx());
    expect(plan.created).toEqual([]);
    expect(plan.updated).toHaveLength(1);
    expect(plan.updated[0]).toMatchObject({ id: 'brf_1', version: 3, origin: 'ai', decision: 'pending', runId: plan.run.id });
    expect(plan.updated[0]).not.toHaveProperty('decisionNote');
    expect(plan.events.map((e) => [e.kind, e.fromVersion, e.toVersion])).toEqual([['edited', 2, 3], ['reset', 3, 3]]);
  });

  it('is a no-op when the AI returns an identical body', () => {
    const plan = planRunOutput(state, output({ run, drafts: [{ type: 'brief', body: briefBody('v1') }] }), ctx());
    expect([plan.created, plan.updated, plan.events]).toEqual([[], [], []]);
  });

  it('rejects a second singleton in the same output', () => {
    const drafts = [{ type: 'brief' as const, body: briefBody('a') }, { type: 'brief' as const, body: briefBody('b') }];
    const plan = planRunOutput(empty, output({ run, drafts }), ctx());
    expect(plan.created).toHaveLength(1);
    expect(plan.issues).toEqual([{ kind: 'duplicate_singleton', index: 1, type: 'brief' }]);
  });
});

describe('planRunOutput · validation', () => {
  it('rejects an invalid run record', () => {
    expect(() => planRunOutput(empty, output({ run: runInput({ latencyMs: -1 }) }), ctx())).toThrow(RepositoryError);
  });

  it('accepts a persona body built by an adapter (fixture sanity)', () => {
    expect(planRunOutput(empty, output({ drafts: [{ type: 'persona', body: personaBody() }] }), ctx()).created).toHaveLength(1);
  });
});
