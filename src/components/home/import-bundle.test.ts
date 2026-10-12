import { describe, expect, it } from 'vitest';
import { toGraphExport, toMarkdown } from '@/components/shell/export-format';
import { briefBody, makeItem, personaBody } from '@/lib/model/__fixtures__/model';
import { markdownNotice, parseImport } from './import-bundle';

const brief = makeItem({
  id: 'b', node: 'brief', type: 'brief', decision: 'accepted',
  body: { ...briefBody('做 AI 陪练', '老板说\n要做陪练'), answers: [{ question: 'Q', answer: 'A' }] },
});
const persona = makeItem({ id: 'p', body: personaBody('小米'), aiStance: { verdict: 'recommend', reason: '主用户' } });
const rejected = makeItem({ id: 'r', body: personaBody('小刚'), decision: 'rejected', decisionNote: '重复' });

describe('export → import round trip', () => {
  it('JSON export re-imports as a graph', () => {
    const json = JSON.stringify(toGraphExport('项目A', { items: [brief, persona], links: [] }));
    const parsed = parseImport(json, 'x.json');
    expect(parsed).toMatchObject({ kind: 'graph', name: '项目A' });
    expect(parsed.kind === 'graph' && parsed.items).toHaveLength(2);
  });

  it('Markdown export lists decisions and gives the raw brief text back', () => {
    const md = toMarkdown('项目A', [brief, persona, rejected]);
    expect(md).toContain('## 01 Brief');
    expect(md).toContain('- · 小米 · o（AI 推荐：主用户）');
    expect(md).toContain('- ✗ 小刚 · o —— 否决理由：重复');
    const parsed = parseImport(md, 'x.md');
    expect(parsed).toMatchObject({ kind: 'markdown', name: '项目A', rawText: '老板说\n要做陪练', downstream: 1 });
    expect(parsed.kind === 'markdown' && markdownNotice(parsed)).toContain('只恢复了 Brief 的原始陈述');
  });
});

describe('parseImport errors', () => {
  it('refuses the old per-node JSON and foreign files', () => {
    expect(() => parseImport(JSON.stringify({ project: 'x', nodes: { brief: {} } }), 'old.json')).toThrow(/旧版/);
    expect(() => parseImport('{"a":1}', 'x.json')).toThrow(/不是思考工作台导出格式/);
    expect(() => parseImport('not json', 'x.json')).toThrow(/不是合法的 JSON/);
    expect(() => parseImport('# 只有标题\n', 'x.md')).toThrow(/没识别出任何节点内容/);
  });
});
