import { describe, expect, it } from 'vitest';
import { jobBody, makeItem, runInput } from '@/lib/model/__fixtures__/model';
import type { Run } from '@/lib/model/types';
import { jobsBasis, type JobItem, type PersonaItem } from './users-meta';

const run = (id: string, inputs: string[] = []): Run => ({
  ...runInput({ inputs: inputs.map((itemId) => ({ itemId, version: 1 })) }),
  id, projectId: 'p', createdAt: '2026-10-13T00:00:00.000Z',
});
const persona = (id: string, runId?: string) => makeItem({ id, ...(runId ? { runId } : {}) }) as PersonaItem;
const job = (id: string, runId: string) => makeItem({ id, type: 'job', body: jobBody(), runId }) as JobItem;

describe('jobsBasis', () => {
  const personas = [persona('p1', 'run_a'), persona('p2', 'run_a'), persona('p3', 'run_b')];

  it('is the persona inputs of the run that last wrote the jobs (refine)', () => {
    const runs = [run('run_c', ['brf', 'p3', 'p1']), run('run_a', ['brf'])];
    expect(jobsBasis([job('j1', 'run_c')], personas, runs)).toEqual(['p1', 'p3']);
  });

  it('falls back to the personas that run created (initial analysis)', () => {
    expect(jobsBasis([job('j1', 'run_a')], personas, [run('run_a', ['brf'])])).toEqual(['p1', 'p2']);
  });

  it('is empty without a known run', () => {
    expect(jobsBasis([], personas, [])).toEqual([]);
  });
});
