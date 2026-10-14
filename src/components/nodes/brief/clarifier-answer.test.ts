import { describe, expect, it } from 'vitest';
import { answerText, needsNote } from './clarifier-answer';

describe('clarifier answers', () => {
  it('asks for a note on "其他" and on any "（请补充）" option', () => {
    expect(needsNote('其他（请补充）')).toBe(true);
    expect(needsNote('有具体参考产品（请补充）')).toBe(true);
    expect(needsNote('其他')).toBe(true);
    expect(needsNote('移动App（手机/平板）')).toBe(false);
  });

  it('drops the "（请补充）" prompt and appends the note when there is one', () => {
    expect(answerText('其他（请补充）', '  家长端小程序 ')).toBe('其他：家长端小程序');
    expect(answerText('有具体参考产品（请补充）', 'Duolingo')).toBe('有具体参考产品：Duolingo');
    expect(answerText('有具体参考产品(请补充)', '')).toBe('有具体参考产品');
    expect(answerText('其他（请补充）', '')).toBe('其他');
    expect(answerText('移动App（手机/平板）', '')).toBe('移动App（手机/平板）');
  });
});
