import { describe, expect, it } from 'vitest';
import { validConsistencyCheck } from '../ai/schemas/__fixtures__/consistency-check';
import { validFeature } from '../ai/schemas/__fixtures__/draft-features';
import { adaptConsistencyCheck, CONSISTENCY_SCOPES } from './adapters';
import { consistencyInput, digestText } from './consistency-context';
import type { Item } from './item-types';
import type { Link } from './types';
import { briefBody, jobBody, makeItem, PROJECT } from './__fixtures__/model';

const { id: _id, traces: _t, ...featureBody } = validFeature(1);
const feature = (id: string, node: 'feat' | 'final', decision: Item['decision'] = 'accepted') =>
  makeItem({ id, node, type: 'feature', decision, body: { ...featureBody, name: id } });

describe('consistencyInput', () => {
  const items: Item[] = [
    makeItem({ id: 'brf_1', node: 'brief', type: 'brief', decision: 'accepted', body: { ...briefBody('问题', '很长的原文'), highlights: [] } }),
    makeItem({ id: 'red_1', node: 'brief', type: 'red_line', decision: 'accepted', body: { text: '不做排名羞辱' } }),
    makeItem({ id: 'job_a', type: 'job', decision: 'accepted', body: jobBody('卡住时知道下一步') }),
    makeItem({ id: 'job_b', type: 'job', body: jobBody('未裁决的 Job') }),
    makeItem({ id: 'job_r', type: 'job', decision: 'rejected', body: jobBody('否决的 Job') }),
    feature('ftr_feat', 'feat'),
    feature('ftr_final', 'final'),
    makeItem({ id: 'crt_1', type: 'critique', body: { kind: 'ask', title: 't', body: 'b' } }),
  ];
  const links: Link[] = [
    { id: 'l1', projectId: PROJECT, from: 'ftr_final', to: 'job_a', rel: 'serves', toVersionSeen: 1 },
    { id: 'l2', projectId: PROJECT, from: 'ftr_final', to: 'job_r', rel: 'serves', toVersionSeen: 1 },
  ];

  it('takes the downstream context per node and type: accepted when any, never rejected, final list over feat', () => {
    const input = consistencyInput(items, links);
    expect(input.items.map((i) => i.id)).toEqual(['brf_1', 'red_1', 'job_a', 'ftr_final']);
    expect(input.sources.map((i) => i.id)).toEqual(input.items.map((i) => i.id));
    expect(input.items.find((i) => i.id === 'ftr_final')?.links).toEqual(['serves:job_a']);
    expect(input.nodeOf.get('ftr_final')).toBe('final');
  });

  it('digests a body as key=value pairs without the raw text and other noise', () => {
    const brief = digestText(items[0]);
    expect(brief).toContain('problem_statement=问题');
    expect(brief).not.toContain('很长的原文');
    const long = makeItem({ id: 'p', body: { role: 'primary', name: 'x'.repeat(500), one_liner: 'o', meta: 'm', story: 's', pain: 'p' } });
    expect(digestText(long).length).toBe(400);
  });
});

describe('adaptConsistencyCheck', () => {
  const nodeOf = new Map([['ftr_00000001', 'final' as const], ['red_00000001', 'brief' as const], ['tsk_00000003', 'split' as const]]);

  it('places each finding on its most downstream item, keeps the stance and drops made-up ids', () => {
    const out = {
      findings: [
        ...validConsistencyCheck.findings,
        { ...validConsistencyCheck.findings[0], item_ids: ['made_up'] },
        { ...validConsistencyCheck.findings[1], item_ids: ['made_up', 'red_00000001'] },
      ],
    } as Parameters<typeof adaptConsistencyCheck>[0];
    const { drafts, replace } = adaptConsistencyCheck(out, { nodeOf, runNode: 'users' });
    expect(drafts.map((d) => [d.node, (d.body as { item_ids: string[] }).item_ids])).toEqual([
      ['final', ['ftr_00000001', 'red_00000001']], ['split', ['tsk_00000003']], ['brief', ['red_00000001']],
    ]);
    expect(drafts[0].aiStance).toEqual({ verdict: 'recommend', reason: '功能描述明确写了班级排名' });
    expect(replace).toBe(CONSISTENCY_SCOPES);
    expect(replace.every((s) => s.type === 'finding' && s.exhaustive)).toBe(true);
  });
});
