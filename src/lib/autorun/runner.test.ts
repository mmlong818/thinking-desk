import { describe, expect, it } from 'vitest';
import { fixtureDeps, type Captured } from '../../../evals/lib/offline';
import { STEP_FIXTURES } from '../../../evals/lib/fixtures';
import { completedNodes } from '../model/completion';
import { LocalRepository } from '../model/local-repository';
import { memoryStorage } from '../model/__fixtures__/storage';
import type { TaskOptions } from '../ai/run-task';
import { CHAIN_STEPS, type StepName } from './chain';
import { AUTORUN_NOTE } from './persist';
import { executeAutorun, type AutorunDeps } from './runner';
import type { AutorunPatch, AutorunSink } from './types';

const PROJECT = 'proj-auto';

function memorySink() {
  const row: AutorunPatch = {};
  const sink: AutorunSink = { update: async (_id, patch) => void Object.assign(row, patch) };
  return { row, sink };
}

async function run(opts: { fail?: StepName; signal?: AbortSignal } = {}) {
  const repo = new LocalRepository({ storage: memoryStorage() });
  const { row, sink } = memorySink();
  const captured = new Map<StepName, Captured>();
  const taskOptions: AutorunDeps['taskOptions'] = (step) => ({
    deps: fixtureDeps(step === opts.fail ? 'not json' : STEP_FIXTURES[step], { onRequest: (c) => captured.set(step, c) }),
  });
  await executeAutorun(
    { runId: 'r1', projectId: PROJECT, projectName: '自动跑', rawText: '一段想法', signal: opts.signal ?? new AbortController().signal },
    { repo, sink, taskOptions, now: () => new Date('2026-10-15T00:00:00Z') },
  );
  return { repo, row, captured };
}

describe('executeAutorun', () => {
  it('runs every step, unlocks all nine nodes and returns the PRD, design and split', async () => {
    const { repo, row } = await run();
    expect(row.status).toBe('done');
    expect(row.steps?.map((s) => s.status)).toEqual(CHAIN_STEPS.map(() => 'ok'));
    expect(row.steps?.every((s) => s.provider === 'claude' && s.model === 'fixture-model')).toBe(true);
    expect([...completedNodes(await repo.listItems(PROJECT))].sort()).toEqual(
      ['alt', 'brief', 'feat', 'final', 'leap', 'scen', 'split', 'stake', 'users'],
    );
    expect(row.result?.prdMarkdown).toContain('# 自动跑 · 产品需求文档（PRD）');
    expect(row.result?.design.sections.length).toBeGreaterThan(0);
    expect(row.result?.design.modules.length).toBeGreaterThan(0);
    expect(row.result?.split?.subtasks.length).toBeGreaterThan(0);
  });

  it('records its acceptances as AI decisions, apart from the person', async () => {
    const { repo } = await run();
    const accepted = (await repo.listEvents(PROJECT)).filter((e) => e.kind === 'accepted');
    expect(accepted.length).toBeGreaterThan(0);
    expect(accepted.every((e) => e.actor === 'ai' && e.note === AUTORUN_NOTE)).toBe(true);
    expect((await repo.listRuns(PROJECT))).toHaveLength(CHAIN_STEPS.length);
  });

  it('quotes stored items by their permanent ids in later prompts', async () => {
    const { repo, captured } = await run();
    const features = (await repo.listItems(PROJECT)).filter((i) => i.node === 'final' && i.type === 'feature' && i.decision === 'accepted');
    const prompt = JSON.stringify(captured.get('design')?.req.messages);
    expect(features.length).toBeGreaterThan(0);
    for (const f of features) expect(prompt).toContain(f.id);
  });

  it('fails without a design: the failed step is recorded and the rest skipped', async () => {
    const { repo, row } = await run({ fail: 'features' });
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/^features: invalid_output/);
    expect(row.steps?.slice(7).map((s) => s.status)).toEqual(['failed', 'skipped', 'skipped', 'skipped', 'skipped']);
    expect((await repo.listRuns(PROJECT)).filter((r) => r.status === 'failed')).toHaveLength(1);
  });

  it('ends done without a split, saying why', async () => {
    const { row } = await run({ fail: 'split' });
    expect(row.status).toBe('done');
    expect(row.result?.split).toBeUndefined();
    expect(row.error).toMatch(/^split: /);
  });

  it('streams each call, so a long-thinking answer is not cut off waiting for headers', async () => {
    const repo = new LocalRepository({ storage: memoryStorage() });
    const { row, sink } = memorySink();
    const streamOnly = (step: StepName): Partial<TaskOptions> => {
      const base = fixtureDeps(STEP_FIXTURES[step]);
      return {
        deps: {
          ...base,
          resolve: async (task, override) => {
            const { provider, model } = await base.resolve(task, override);
            return {
              model,
              provider: {
                ...provider,
                complete: async () => { throw new Error('not streamed'); },
                stream: (m, req, onDelta) => provider.complete(m, req).then((r) => (onDelta(r.text), r)),
              },
            };
          },
        },
      };
    };
    await executeAutorun(
      { runId: 'r1', projectId: PROJECT, projectName: '自动跑', rawText: '一段想法', signal: new AbortController().signal },
      { repo, sink, taskOptions: streamOnly },
    );
    expect(row.status).toBe('done');
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    controller.abort();
    const { row } = await run({ signal: controller.signal });
    expect(row.status).toBe('cancelled');
    expect(row.steps?.every((s) => s.status === 'pending')).toBe(true);
  });
});
