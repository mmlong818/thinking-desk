import { describe, expect, it } from 'vitest';
import { ITEM_TYPES } from './types';
import { jobBody, makeItem, personaBody } from './__fixtures__/model';
import { buildFeedback, isEmptyFeedback, itemSummary, RegenerationFeedbackSchema } from './feedback';

describe('buildFeedback', () => {
  const items = [
    makeItem({ id: 'p_acc', decision: 'accepted', body: personaBody('小米') }),
    makeItem({ id: 'p_edit', origin: 'ai_edited', body: personaBody('小明') }),
    makeItem({ id: 'p_new', body: personaBody('小红') }),
    makeItem({ id: 'p_rej', decision: 'rejected', decisionNote: '和小米重复', body: personaBody('小刚') }),
    makeItem({ id: 'p_gone', decision: 'accepted', deletedAt: '2026-10-13T02:00:00.000Z' }),
    makeItem({ id: 'j_acc', type: 'job', decision: 'accepted', body: jobBody('写作业') }),
  ];

  it('keeps accepted and human-touched items, avoids rejected ones with the note, in scope only', () => {
    const fb = buildFeedback(items, [{ node: 'users', type: 'persona' }]);
    expect(fb.keep.map((k) => k.id)).toEqual(['p_acc', 'p_edit']);
    expect(fb.avoid).toEqual([{ id: 'p_rej', type: 'persona', summary: '小刚 · o', note: '和小米重复' }]);
    expect(RegenerationFeedbackSchema.parse(fb)).toEqual(fb);
    expect(isEmptyFeedback(fb)).toBe(false);
  });

  it('moves kept items whose upstream changed into revisit, naming the new upstream', () => {
    const persona = makeItem({ id: 'per_1', version: 2, body: personaBody('小米') });
    const job = makeItem({ id: 'job_1', type: 'job', decision: 'accepted', body: jobBody('写作业') });
    const fresh = makeItem({ id: 'job_2', type: 'job', decision: 'accepted', body: jobBody('背单词') });
    const links = [
      { id: 'l1', projectId: 'proj-1', from: 'job_1', to: 'per_1', rel: 'derived_from' as const, toVersionSeen: 1 },
      { id: 'l2', projectId: 'proj-1', from: 'job_2', to: 'per_1', rel: 'derived_from' as const, toVersionSeen: 2 },
    ];
    const fb = buildFeedback([persona, job, fresh], [{ node: 'users', type: 'job' }], links);
    expect(fb.keep.map((k) => k.id)).toEqual(['job_2']);
    expect(fb.revisit).toEqual([{ id: 'job_1', type: 'job', summary: '[functional] 写作业', changed: 'persona [per_1] 小米 · o' }]);
    expect(buildFeedback([persona, job, fresh], [{ node: 'users', type: 'job' }]).revisit).toEqual([]);
    expect(isEmptyFeedback({ keep: [], avoid: [], revisit: fb.revisit })).toBe(false);
  });

  it('is empty when nothing in scope was judged', () => {
    expect(isEmptyFeedback(buildFeedback(items, [{ node: 'stake', type: 'stakeholder' }]))).toBe(true);
    expect(isEmptyFeedback(undefined)).toBe(true);
  });
});

describe('itemSummary', () => {
  it('summarises every item type in one clipped line', () => {
    expect(itemSummary(makeItem({ id: 'j', type: 'job', body: jobBody('写作业') }))).toBe('[functional] 写作业');
    const long = makeItem({ id: 'p', body: personaBody('x'.repeat(300)) });
    expect(itemSummary(long).length).toBeLessThanOrEqual(120);
    expect(ITEM_TYPES.length).toBe(32);
  });
});
