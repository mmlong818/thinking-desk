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
    expect(ITEM_TYPES.length).toBe(31);
  });
});
