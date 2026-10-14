import { describe, expect, it } from 'vitest';
import { humanizeIds } from './humanize-ids';

const names = new Map([
  ['alt_04', '豆包等通用AI助手'],
  ['alt_07', '卡住就跳过'],
  ['alt_08', '用搜题软件查答案'],
  ['job_ukpfjfvl', '做出难题后被追问思路'],
]);

describe('humanizeIds', () => {
  it('drops a parenthetical that only lists ids (the name is already written before it)', () => {
    expect(humanizeIds('豆包等通用AI助手（alt_04）：免费', names)).toBe('豆包等通用AI助手：免费');
    expect(humanizeIds('非消费替代（alt_07+alt_08）：学生卡住时', names)).toBe('非消费替代：学生卡住时');
    expect(humanizeIds('对手 (alt_04, alt_07) 都免费', names)).toBe('对手 都免费');
  });

  it('drops an id that is followed by its name in brackets', () => {
    expect(humanizeIds('都没有覆盖 job_ukpfjfvl（做出难题后被追问思路以巩固）', names))
      .toBe('都没有覆盖（做出难题后被追问思路以巩固）');
  });

  it('replaces any other id with the item name and leaves unknown tokens alone', () => {
    expect(humanizeIds('alt_08 本质是搜题App的使用方式', names)).toBe('「用搜题软件查答案」本质是搜题App的使用方式');
    expect(humanizeIds('参见 alt_99 与 my_alt_04x', names)).toBe('参见 alt_99 与 my_alt_04x');
  });

  it('walks nested bodies and keeps non-string values', () => {
    const body = { title: '威胁', items: ['alt_08 很强', { note: '（alt_04）' }], n: 3, ok: true };
    expect(humanizeIds(body, names)).toEqual({ title: '威胁', items: ['「用搜题软件查答案」很强', { note: '' }], n: 3, ok: true });
  });

  it('returns the input unchanged when there are no names', () => {
    const body = { text: 'alt_08' };
    expect(humanizeIds(body, new Map())).toBe(body);
  });
});
