'use client';

import { useProject } from '@/components/project/ProjectStore';
import { useAiAction, type AiActionState } from '@/components/project/useAiAction';
import type { NodeData } from '@/components/project/useNodeData';
import { DIMENSION_KEYS } from '@/lib/ai/schemas/analyze-scenarios';
import { adaptDeepAnalysis, adaptDimensions, adaptScenarioDrafts } from '@/lib/model/adapters';
import { inputsOf, type BriefRequestContext } from '@/lib/model/context';
import { buildFeedback } from '@/lib/model/feedback';
import type { Link } from '@/lib/model/types';
import { briefPayload, jobPayload, linkedIds, personaPayload } from '@/lib/store/request-context';
import { accepted, MAX_DEEP, type ElementItem, type ScenarioItem } from './scen-meta';

interface Ctx {
  ai: AiActionState;
  data: NodeData;
  brief: BriefRequestContext;
  slug: string;
}

function common({ data, brief, slug }: Ctx) {
  const personas = data.context('users', 'persona');
  const jobs = data.context('users', 'job');
  const body = {
    projectSlug: slug,
    ...briefPayload(brief),
    personas: personas.map(personaPayload),
    lockedJobs: jobs.map((j) => jobPayload(j, data.links)),
  };
  return { body, inputs: inputsOf(brief.items, personas, jobs), jobs };
}

/** Every kept (non-rejected) element by dimension, under its permanent id. */
function dimensionsPayload(elements: ElementItem[]) {
  const live = elements.filter((e) => e.decision !== 'rejected');
  return {
    dimensions: Object.fromEntries(DIMENSION_KEYS.map((dim) => [
      dim,
      live.filter((e) => e.body.dim === dim).map((e) => ({ id: e.id, text: e.body.text, relevance: e.body.relevance })),
    ])),
  };
}

export function scenarioPayload(s: ScenarioItem, links: readonly Link[], jobIds: ReadonlySet<string>) {
  const targets = (rel: 'derived_from' | 'serves') => linkedIds(links, s.id, rel);
  return {
    id: s.id, title: s.body.title, meta: s.body.meta, narrative: s.body.narrative, pain_hint: s.body.pain_hint,
    element_ids: targets('derived_from'),
    job_ids: targets('serves').filter((id) => jobIds.has(id)),
  };
}

function combine(ctx: Ctx, setError: (m: string) => void) {
  const elements = ctx.data.of('scenario_element');
  const picked = accepted(elements);
  if (picked.length < 3) return setError('至少勾选 3 个要素才能组合情景');
  const { body, inputs } = common(ctx);
  return ctx.ai.run('combine', {
    route: '/api/ai/scenarios',
    body: {
      action: 'combine', ...body, dimensions: dimensionsPayload(elements), selectedElementIds: picked.map((e) => e.id),
      feedback: buildFeedback(ctx.data.all, [{ node: 'scen', type: 'scenario' }]),
    },
    node: 'scen', inputs: [...inputs, ...inputsOf(picked)], adapt: adaptScenarioDrafts,
  });
}

function deep(ctx: Ctx, setError: (m: string) => void) {
  const scenarios = ctx.data.of('scenario');
  const picked = accepted(scenarios);
  if (picked.length === 0) return setError('至少选 1 个情景深入');
  if (picked.length > MAX_DEEP) return setError(`最多深入 ${MAX_DEEP} 个情景`);
  const { body, inputs, jobs } = common(ctx);
  const jobIds = new Set(jobs.map((j) => j.id));
  const scope = (['insight', 'pain_point', 'extreme', 'hostile', 'delight_point'] as const).map((type) => ({ node: 'scen' as const, type }));
  return ctx.ai.run('deep', {
    route: '/api/ai/scenarios',
    body: {
      action: 'deep', ...body,
      scenarios: scenarios.filter((s) => s.decision !== 'rejected').map((s) => scenarioPayload(s, ctx.data.links, jobIds)),
      pickedScenarioIds: picked.map((s) => s.id),
      feedback: buildFeedback(ctx.data.all, scope),
    },
    node: 'scen', inputs: [...inputs, ...inputsOf(picked)], adapt: adaptDeepAnalysis,
  });
}

/** Exhaust the 7 dimensions → combine accepted elements into scenarios → deep-analyse accepted scenarios. */
export function useScenActions(data: NodeData, brief: BriefRequestContext | null, onDone: () => void) {
  const { slug } = useProject();
  const ai = useAiAction();
  const finish = async (p: Promise<unknown> | void) => {
    const out = (await p) as { ok?: boolean } | undefined;
    if (out?.ok) onDone();
  };
  const ctx = brief ? { ai, data, brief, slug } : null;
  return {
    running: ai.running,
    error: ai.error,
    setError: ai.setError,
    exhaust: () => {
      if (!ctx) return;
      const { body, inputs } = common(ctx);
      const feedback = buildFeedback(data.all, [{ node: 'scen', type: 'scenario_element' }]);
      void finish(ai.run('exhaust', { route: '/api/ai/scenarios', body: { action: 'exhaust', ...body, feedback }, node: 'scen', inputs, adapt: adaptDimensions }));
    },
    combine: () => ctx && void finish(combine(ctx, ai.setError)),
    deep: () => ctx && void finish(deep(ctx, ai.setError)),
  };
}
