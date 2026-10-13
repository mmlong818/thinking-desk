import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConsistencyFinding } from '../src/lib/ai/schemas/consistency-check';
import { loadBriefs } from './lib/briefs';
import { isCoverageFinding, loadChainOutputs, PLANTED, PLANTED_ID, plantedItem, scoreCheck } from './lib/consistency-eval';

const finding = (title: string, item_ids: string[], severity: ConsistencyFinding['severity'] = 'medium'): ConsistencyFinding => ({
  item_ids, title, description: 'd', severity, suggested_fix: 'f', stance: { verdict: 'recommend', reason: 'r' },
});

describe('consistency eval', () => {
  it('plants one contradiction per golden brief', () => {
    expect(Object.keys(PLANTED).sort()).toEqual(loadBriefs().map((b) => b.id));
    expect(plantedItem('04-internal-tool')).toMatchObject({ id: PLANTED_ID, type: 'feature', decision: 'accepted' });
    expect(() => plantedItem('99-none')).toThrow(/no planted/);
  });

  it('tells split-coverage findings from contradictions', () => {
    expect(isCoverageFinding(finding('财务异常推送功能无子任务拆分', ['F08']))).toBe(true);
    expect(isCoverageFinding(finding('拼单功能缺少独立子任务拆分', ['F02']))).toBe(true);
    expect(isCoverageFinding(finding('微校准被描述为不弹窗，子任务却画弹窗', ['ft11']))).toBe(false);
    expect(isCoverageFinding(finding('明信片子任务挂在F1而非F4，归属错位', ['F4']))).toBe(false);
  });

  it('loads a step that succeeded on its retry, and nothing when a needed step failed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'td-cons-'));
    const save = (file: string, record: object) => writeFileSync(join(dir, file), JSON.stringify(record));
    save('01-brief.json', { step: 'brief', status: 'ok', data: { fields: {} } });
    save('10-revise.json', { step: 'revise', status: 'retried', data: { revised_features: [] } });
    save('12-split.json', { step: 'split', status: 'failed', error: 'x' });
    expect(loadChainOutputs(dir)).toBeNull();
    save('12-split.json', { step: 'split', status: 'retried', data: { splits: [] } });
    expect(loadChainOutputs(dir)?.revise).toEqual({ revised_features: [] });
  });

  it('scores recall on the planted run only', () => {
    const findings = [finding('a', ['ft_plant', 'red_1'], 'medium'), finding('b', [PLANTED_ID], 'high'), finding('F08 无子任务', ['F08'])];
    expect(scoreCheck(findings, true)).toEqual({ findings: 3, coverage: 1, caught: true, plantedSeverity: 'high' });
    expect(scoreCheck([finding('x', ['F1'])], true)).toEqual({ findings: 1, coverage: 0, caught: false });
    expect(scoreCheck(findings, false)).toEqual({ findings: 3, coverage: 1 });
  });
});
