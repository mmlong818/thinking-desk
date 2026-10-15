import type { TaskOptions } from '../ai/run-task';
import { toPrdMarkdown } from '../export/prd';
import type { Repository } from '../model/repository';
import type { Item } from '../model/item-types';
import { CHAIN_STEPS, runStep, STEPS, type Ctx, type StepName, type StepRecord } from './chain';
import { persistStep } from './persist';
import type { AutorunResult, AutorunSink, AutorunStep } from './types';

// Runs the whole chain for one project: each step calls the AI, is saved and judged (persist.ts),
// and reported to the sink. A step whose inputs failed is skipped. Without a design the run fails;
// a failed split still ends 'done' (the design is there), with the error said.

/** One step may think for a long while (GLM-5.3 cannot turn thinking off). */
export const AUTORUN_STEP_TIMEOUT_MS = 900_000;

export interface AutorunJob {
  runId: string;
  projectId: string;
  projectName: string;
  rawText: string;
  model?: string;
  signal: AbortSignal;
}

export interface AutorunDeps {
  repo: Repository;
  sink: AutorunSink;
  /** Extra task options per step (tests: an offline provider). */
  taskOptions?: (step: StepName) => Partial<TaskOptions>;
  now?: () => Date;
}

export const pendingSteps = (): AutorunStep[] =>
  CHAIN_STEPS.map((step) => ({ step, task: STEPS[step].task, status: 'pending' }));

function reported(record: StepRecord): AutorunStep {
  const run = record.run;
  return {
    step: record.step, task: record.task, status: record.status,
    ...(run ? { provider: run.provider, model: run.model, latencyMs: Math.round(run.latencyMs) } : {}),
    ...(run?.usage ? { usage: run.usage } : {}),
    ...(record.error ? { error: record.error } : {}),
  };
}

const accepted = (items: readonly Item[], node: Item['node'], type: Item['type']) =>
  items.filter((i) => !i.deletedAt && i.decision === 'accepted' && i.node === node && i.type === type);

async function collectResult(repo: Repository, job: AutorunJob, splitOk: boolean, now?: () => Date): Promise<AutorunResult> {
  const graph = await repo.getGraph(job.projectId);
  return {
    prdMarkdown: toPrdMarkdown(job.projectName, graph, now ? { now: now() } : {}),
    design: { sections: accepted(graph.items, 'final', 'design_section'), modules: accepted(graph.items, 'final', 'module') },
    ...(splitOk ? { split: { subtasks: accepted(graph.items, 'split', 'subtask') } } : {}),
  };
}

export async function executeAutorun(job: AutorunJob, deps: AutorunDeps): Promise<void> {
  const steps = pendingSteps();
  const ctx: Ctx = { rawText: job.rawText, out: {} };
  await deps.sink.update(job.runId, { status: 'running', steps });
  for (const [i, step] of CHAIN_STEPS.entries()) {
    if (job.signal.aborted) break;
    steps[i] = { ...steps[i], status: 'running' };
    await deps.sink.update(job.runId, { currentStep: step, steps });
    const options: TaskOptions = {
      model: job.model, signal: job.signal, timeoutMs: AUTORUN_STEP_TIMEOUT_MS,
      // Stream: an answer held back for > 300 s (long thinking) hits undici's headers timeout ('fetch failed').
      onProgress: () => undefined,
      ...deps.taskOptions?.(step),
    };
    const record = await runStep(step, ctx, options);
    await persistStep(deps.repo, job.projectId, ctx, record).catch((e: unknown) => {
      delete ctx.out[step];
      Object.assign(record, { status: 'failed', error: `saving failed: ${e instanceof Error ? e.message : String(e)}` });
    });
    steps[i] = reported(record);
    await deps.sink.update(job.runId, { steps });
  }
  if (job.signal.aborted) {
    await deps.sink.update(job.runId, { status: 'cancelled', currentStep: null, steps });
    return;
  }
  if (!ctx.out.design) {
    const cause = steps.find((s) => s.status === 'failed');
    await deps.sink.update(job.runId, {
      status: 'failed', currentStep: null, error: cause ? `${cause.step}: ${cause.error ?? 'failed'}` : 'design missing',
    });
    return;
  }
  const splitOk = ctx.out.split !== undefined;
  await deps.sink.update(job.runId, {
    status: 'done', currentStep: null, result: await collectResult(deps.repo, job, splitOk, deps.now),
    ...(splitOk ? {} : { error: `split: ${steps.find((s) => s.step === 'split')?.error ?? 'failed'}` }),
  });
}
