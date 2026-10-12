import { describe, expect, it } from 'vitest';
import { BriefSnapshotSchema } from '../ai/schemas/snapshots';
import { briefBody, jobBody, makeItem } from './__fixtures__/model';
import { briefRequestContext, contextIsJudged, contextItems, inputsOf } from './context';

const persona = (id: string, decision: 'pending' | 'accepted' | 'rejected' = 'pending', deletedAt?: string) =>
  makeItem({ id, decision, ...(deletedAt ? { deletedAt } : {}) });

describe('contextItems', () => {
  it('uses every unjudged, non-rejected item until the person accepts one', () => {
    const items = [persona('a'), persona('b', 'rejected'), persona('c'), persona('d', 'pending', '2026-10-13T02:00:00.000Z')];
    expect(contextItems(items, 'users', 'persona').map((i) => i.id)).toEqual(['a', 'c']);
    expect(contextIsJudged(items, 'users', 'persona')).toBe(false);
  });

  it('switches to the accepted items once any is accepted', () => {
    const items = [persona('a'), persona('b', 'accepted'), persona('c')];
    expect(contextItems(items, 'users', 'persona').map((i) => i.id)).toEqual(['b']);
    expect(contextIsJudged(items, 'users', 'persona')).toBe(true);
  });

  it('only looks at the requested node and type', () => {
    const items = [persona('a'), makeItem({ id: 'j', type: 'job', body: jobBody() })];
    expect(contextItems(items, 'users', 'job').map((i) => i.id)).toEqual(['j']);
    expect(contextItems(items, 'stake', 'persona')).toEqual([]);
  });
});

describe('inputsOf', () => {
  it('records each item once with the version the prompt saw', () => {
    const a = makeItem({ id: 'a', version: 3 });
    expect(inputsOf([a], [a, makeItem({ id: 'b' })])).toEqual([
      { itemId: 'a', version: 3 },
      { itemId: 'b', version: 1 },
    ]);
  });
});

describe('briefRequestContext', () => {
  const brief = makeItem({
    id: 'brf_1', node: 'brief', type: 'brief',
    body: { ...briefBody('问题', '原文'), highlights: [{ text: '事实', kind: 'fact' }], answers: [{ question: 'Q', answer: 'A' }] },
  });
  const redLine = makeItem({ id: 'red_1', node: 'brief', type: 'red_line', body: { text: '不收集生物信息' } });
  const rejectedRedLine = makeItem({ id: 'red_2', node: 'brief', type: 'red_line', body: { text: 'x' }, decision: 'rejected' });
  const assumption = makeItem({
    id: 'asm_1', node: 'brief', type: 'assumption',
    body: { statement: 's', quote: '学生愿意', rationale: '无数据', status: 'untested' },
  });

  it('rebuilds the snapshot the AI routes validate, with red lines and assumptions re-merged', () => {
    const ctx = briefRequestContext([brief, redLine, rejectedRedLine, assumption]);
    expect(ctx).not.toBeNull();
    expect(BriefSnapshotSchema.safeParse(ctx?.brief).success).toBe(true);
    expect(ctx?.brief.fields.red_lines).toEqual(['不收集生物信息']);
    expect(ctx?.brief.highlights).toEqual([
      { text: '事实', kind: 'fact' },
      { text: '学生愿意', kind: 'assumption', reason: '无数据' },
    ]);
    expect(ctx?.rawText).toBe('原文');
    expect(ctx?.answers).toEqual([{ question: 'Q', answer: 'A' }]);
    expect(ctx?.items.map((i) => i.id)).toEqual(['brf_1', 'red_1', 'asm_1']);
  });

  it('is null without a usable brief', () => {
    expect(briefRequestContext([redLine])).toBeNull();
    expect(briefRequestContext([{ ...brief, decision: 'rejected' }])).toBeNull();
  });
});
