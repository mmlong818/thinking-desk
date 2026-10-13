import { describe, expect, it } from 'vitest';
import { feedbackBlock } from './feedback-prompt';

describe('feedbackBlock', () => {
  it('renders nothing for empty feedback', () => {
    expect(feedbackBlock(undefined)).toBe('');
    expect(feedbackBlock({ keep: [], avoid: [], revisit: [] })).toBe('');
  });

  it('renders keep / avoid inside one data block, and the revisit rule only when there is something to revisit', () => {
    const base = { keep: [{ id: 'job_1', type: 'job' as const, summary: '写作业' }], avoid: [], revisit: [] };
    const plain = feedbackBlock(base);
    expect(plain).toContain('<data name="regeneration_feedback">');
    expect(plain).toContain('- [job_1] (job) 写作业');
    expect(plain).not.toContain('复核');
    const withRevisit = feedbackBlock({
      ...base, revisit: [{ id: 'job_2', type: 'job', summary: '背单词', changed: 'persona [per_1] 小米' }],
    });
    expect(withRevisit).toContain('「复核」的条目同样会保留');
    expect(withRevisit).toContain('- [job_2] (job) 背单词 —— 上游已变：persona [per_1] 小米');
    expect(withRevisit.indexOf('「复核」')).toBeLessThan(withRevisit.indexOf('<data name="regeneration_feedback">'));
  });
});
