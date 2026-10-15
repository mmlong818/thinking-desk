import type { RunTaskDeps, TaskOptions } from '../../src/lib/ai/run-task';
import { generateMorePersonas, refineJobs } from '../../src/lib/ai/tasks/analyze-users';
import { clarifyBrief } from '../../src/lib/ai/tasks/clarify-brief';
import { consistencyCheck } from '../../src/lib/ai/tasks/consistency-check';
import { generateMoreLeapItems } from '../../src/lib/ai/tasks/creative-leap';
import { deriveFollowUps } from '../../src/lib/ai/tasks/derive-follow-ups';
import { freeAsk } from '../../src/lib/ai/tasks/free-ask';
import { probeBrief } from '../../src/lib/ai/tasks/probe-brief';
import type { AiProvider, AiTask, CompleteRequest } from '../../src/lib/ai/types';
import { validClarifyProceed } from '../../src/lib/ai/schemas/__fixtures__/clarify-brief';
import { validConsistencyCheck } from '../../src/lib/ai/schemas/__fixtures__/consistency-check';
import type { ConsistencyItem } from '../../src/lib/ai/schemas/consistency-check';
import { validProbeDone } from '../../src/lib/ai/schemas/__fixtures__/probe-brief';
import { validJobsRefinement, validPersonaBatch } from '../../src/lib/ai/schemas/__fixtures__/users';
import { lockedJobs, type Outputs } from './chain';
import { FOLLOW_UPS_FIXTURE, MORE_LEAP_FIXTURES } from './fixtures';

// Running prompts without an API: a fake provider that records each request and answers with a
// canned output. It borrows `name` / `canDrive` from a real adapter when given one, so a model
// the real adapter refuses (`canDrive`) is refused here too.

export interface Captured {
  task: AiTask;
  req: CompleteRequest;
}

export function fixtureDeps(
  output: unknown,
  opts: { model?: string; like?: AiProvider; onRequest?: (c: Captured) => void } = {},
): RunTaskDeps {
  const name = opts.like?.name ?? 'claude';
  const provider: AiProvider = {
    name,
    isConfigured: () => true,
    listModels: async () => [],
    ...(opts.like?.canDrive ? { canDrive: opts.like.canDrive } : {}),
    complete: async (model, req) => {
      opts.onRequest?.({ task: req.task, req });
      const text = typeof output === 'string' ? output : JSON.stringify(output);
      return { text, provider: name, model, latencyMs: 0, finishReason: 'stop' };
    },
  };
  return { resolve: async () => ({ provider, model: opts.model ?? 'fixture-model' }), now: () => 0 };
}

type Render = (raw: string, out: Outputs, opts: TaskOptions) => Promise<unknown>;

const briefOf = (out: Outputs) => ({ fields: out.brief.fields, highlights: out.brief.highlights });

function moreLeap(category: keyof typeof MORE_LEAP_FIXTURES): { output: unknown; render: Render } {
  return {
    output: MORE_LEAP_FIXTURES[category],
    render: (raw, out, opts) => generateMoreLeapItems({
      brief: briefOf(out), rawText: raw, personas: out.users.personas, lockedJobs: lockedJobs(out.users),
      features: [], category, existing: [],
    }, opts),
  };
}

const accepted = (id: string, type: string, node: string, text: string, links: string[] = []): ConsistencyItem =>
  ({ id, type, node, decision: 'accepted', text, links });

/** What the consistency check would read after the chain: the brief, red lines, revised features, subtasks. */
export function consistencyItemsOf(out: Outputs): ConsistencyItem[] {
  const f = out.brief.fields;
  return [
    accepted('brf_1', 'brief', 'brief', `problem_statement=${f.problem_statement ?? ''}；boundaries=${(f.boundaries ?? []).join(' / ')}`),
    ...(f.red_lines ?? []).map((t, i) => accepted(`red_${i + 1}`, 'red_line', 'brief', `text=${t}`)),
    ...out.revise.revised_features.map((x) => accepted(x.id, 'feature', 'final', `name=${x.name}；description=${x.description}`)),
    ...out.split.splits.flatMap((s) => s.subfeatures.map((sf) => accepted(sf.id, 'subtask', 'split', `title=${sf.title}`, [`implements:${s.feature_id}`]))),
  ];
}

/**
 * Prompt builders outside the main chain (process steps and "more" runs), rendered offline so a
 * change to any prompt shows up in the promptVersion snapshot. `output` is the canned answer.
 */
export const EXTRA_PROMPTS: Record<string, { output: unknown; render: Render }> = {
  clarify: { output: validClarifyProceed, render: (raw, _o, opts) => clarifyBrief({ rawText: raw }, opts) },
  probe: { output: validProbeDone, render: (raw, _o, opts) => probeBrief({ rawText: raw, history: [] }, opts) },
  refine_jobs: {
    output: validJobsRefinement,
    render: (raw, out, opts) => refineJobs({
      brief: briefOf(out), rawText: raw, selectedPersonas: out.users.personas, existingJobs: out.users.jobs, userLockedJobIds: [],
    }, opts),
  },
  more_personas: {
    output: validPersonaBatch,
    render: (raw, out, opts) => generateMorePersonas({ brief: briefOf(out), rawText: raw, existing: out.users.personas, lockedIds: [] }, opts),
  },
  more_first_principles: moreLeap('first_principles'),
  more_analogies: moreLeap('analogies'),
  more_constraint_flips: moreLeap('constraint_flips'),
  follow_ups: { output: FOLLOW_UPS_FIXTURE, render: (_raw, out, opts) => deriveFollowUps({ nodeKind: 'scen', content: out.scen_deep }, opts) },
  consistency: {
    output: validConsistencyCheck,
    render: (_raw, out, opts) => consistencyCheck({ items: consistencyItemsOf(out) }, opts),
  },
  free_ask: {
    output: '你最担心的是哪一步？',
    render: (raw, _o, opts) => freeAsk({
      nodeKind: 'brief', nodeLabel: 'Brief', contextSummary: raw.slice(0, 300), question: '这个需求最大的风险是什么？', history: [],
    }, opts),
  },
};
