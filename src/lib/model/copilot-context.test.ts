import { describe, expect, it } from 'vitest';
import { copilotContext } from './copilot-context';
import { briefBody, jobBody, makeItem, personaBody } from './__fixtures__/model';

describe('copilotContext', () => {
  const items = [
    makeItem({ id: 'b', node: 'brief', type: 'brief', body: briefBody('做 AI 陪练'), decision: 'accepted' }),
    makeItem({ id: 'p1', body: personaBody('小米') }),
    makeItem({ id: 'p2', body: personaBody('小刚'), decision: 'accepted' }),
    makeItem({ id: 'p3', body: personaBody('小红'), decision: 'rejected' }),
    makeItem({ id: 'j', type: 'job', body: jobBody('写作业') }),
    makeItem({ id: 'c', type: 'critique', body: { kind: 'ask', title: 't', body: 'b' } }),
  ];

  it('lists kept items of every node up to the current one, accepted first, never rejected', () => {
    const text = copilotContext(items, 'users');
    expect(text).toContain('## 01 Brief\n- [brief·已采纳] 做 AI 陪练');
    expect(text.indexOf('小刚')).toBeLessThan(text.indexOf('小米'));
    expect(text).not.toContain('小红');
    expect(text).not.toContain('[critique');
    expect(text).toContain('[job·待定] [functional] 写作业');
  });

  it('stops at the current node', () => {
    expect(copilotContext(items, 'brief')).not.toContain('小米');
  });
});
