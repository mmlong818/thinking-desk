import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';
import { toPrdMarkdown, provenance } from './prd';
import { estimateHours, taskRows, toGithubIssues, toJiraCsv, toLinearCsv } from './tasks';
import { EXPORT_PROJECT, exportFixtureGraph } from './__fixtures__/project';
import { makeItem } from '../model/__fixtures__/model';

const NOW = new Date('2026-10-13T08:00:00.000Z');

describe('csv', () => {
  it('quotes only when needed, doubles quotes, ends rows with CRLF', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(toCsv([['a', 1], ['b', undefined]])).toBe('a,1\r\nb,\r\n');
  });
});

describe('estimateHours', () => {
  it.each([['2d', 16], ['0.5d', 4], ['1w', 40], ['4h', 4], ['3 天', 24], ['2', 16], ['2-3d', null], ['', null]])('%s → %s', (text, hours) => {
    expect(estimateHours(text)).toBe(hours);
  });
});

describe('provenance', () => {
  it('names the origin and, for AI items, the stance', () => {
    expect(provenance(makeItem({ id: 'a', aiStance: { verdict: 'caution', reason: 'r' } }))).toBe('〔AI·慎〕');
    expect(provenance(makeItem({ id: 'b', origin: 'ai_edited', aiStance: { verdict: 'recommend', reason: 'r' } }))).toBe('〔AI·改·荐〕');
    expect(provenance(makeItem({ id: 'c', origin: 'human' }))).toBe('〔人〕');
  });
});

describe('PRD Markdown', () => {
  it('matches the snapshot and leaves out pending and rejected items', async () => {
    const md = toPrdMarkdown(EXPORT_PROJECT, await exportFixtureGraph(), { now: NOW });
    expect(md).toMatchSnapshot();
    expect(md).not.toContain('王老师');
    expect(md).not.toContain('班级排行榜');
    expect(md).not.toContain('提示可能直接泄露答案');
    expect(md).toContain('另有 1 条 AI 发现尚未裁决');
  });

  it('is deterministic for the same graph and date', async () => {
    const graph = await exportFixtureGraph();
    expect(toPrdMarkdown(EXPORT_PROJECT, graph, { now: NOW })).toBe(toPrdMarkdown(EXPORT_PROJECT, graph, { now: NOW }));
  });
});

describe('task exports', () => {
  it('orders accepted subtasks so dependencies come first and keeps unexported dependencies as a count', async () => {
    const rows = taskRows(await exportFixtureGraph());
    expect(rows.map((r) => [r.key, r.title, r.dependsOn, r.otherDependencies])).toEqual([
      ['T-1', '实现提示接口', [], 0],
      ['T-2', '画提示页, 含 "下一步" 按钮', ['T-1'], 0],
      ['T-3', '错题导入', [], 1],
      ['T-4', '埋点上报', [], 0],
    ]);
    expect(rows[0]).toMatchObject({ feature: '分步提示', module: '提示引擎', hours: 16, critical: true });
    expect(rows[2]).toMatchObject({ module: '错题管理', hours: null });
  });

  it('Jira CSV: repeated Labels columns, estimate in seconds, Blocks from the blocking row', async () => {
    const csv = toJiraCsv(taskRows(await exportFixtureGraph()));
    expect(csv).toMatchSnapshot();
    const [header, first] = csv.split('\r\n');
    expect(header).toBe('Work item ID,Summary,Description,Work type,Priority,Labels,Labels,Labels,Original Estimate,Blocks');
    expect(first.startsWith('1,实现提示接口,"')).toBe(true);
    expect(first.endsWith(',57600,2')).toBe(true);
  });

  it('Linear CSV: its own column set, labels in one cell, dependencies in the description', async () => {
    const csv = toLinearCsv(taskRows(await exportFixtureGraph()));
    expect(csv).toMatchSnapshot();
    expect(csv.split('\r\n')[0]).toBe('Title,Description,Priority,Status,Assignee,Created,Completed,Labels,Estimate');
    expect(csv).toContain('依赖：T-1 实现提示接口');
    expect(csv).toContain('"layer-backend,critical-path,thinking-desk"');
  });

  it('GitHub issues: labels to create first, then REST payloads in dependency order', async () => {
    const out = toGithubIssues(taskRows(await exportFixtureGraph()));
    expect(out).toMatchSnapshot();
    expect(out.labels.map((l) => l.name)).toEqual(['critical-path', 'layer-backend', 'layer-data', 'thinking-desk']);
    expect(out.issues[1]).toMatchObject({ key: 'T-2', depends_on: ['T-1'], labels: ['layer-backend', 'critical-path', 'thinking-desk'] });
  });
});
