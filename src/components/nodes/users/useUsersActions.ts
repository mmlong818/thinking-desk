'use client';

import type { NodeData } from '@/components/project/useNodeData';
import { useProject } from '@/components/project/ProjectStore';
import { useAiAction, type AiActionState } from '@/components/project/useAiAction';
import { adaptJobsRefinement, adaptPersonaBatch, adaptUsersAnalysis } from '@/lib/model/adapters';
import { inputsOf, type BriefRequestContext } from '@/lib/model/context';
import { buildFeedback } from '@/lib/model/feedback';
import type { Item } from '@/lib/model/item-types';
import { briefPayload, jobsByDimension, personaPayload } from '@/lib/store/request-context';
import { MAX_PERSONAS, type PersonaItem } from './users-meta';

const isPersona = (i: Item): i is PersonaItem => i.type === 'persona';

interface Ctx {
  ai: AiActionState;
  data: NodeData;
  brief: BriefRequestContext | null;
  slug: string;
}

const base = ({ slug, brief }: Ctx) => ({ projectSlug: slug, ...(brief ? briefPayload(brief) : {}) });

function refine(ctx: Ctx, personas: readonly PersonaItem[]) {
  const { ai, data, brief } = ctx;
  const jobs = data.of('job').filter((j) => j.decision !== 'rejected');
  return ai.run('refine', {
    route: '/api/ai/refine-jobs',
    body: {
      ...base(ctx),
      selectedPersonas: personas.map(personaPayload),
      existingJobs: jobsByDimension(jobs, data.links),
      feedback: buildFeedback(data.all, [{ node: 'users', type: 'job' }], data.links),
    },
    node: 'users', inputs: inputsOf(brief?.items ?? [], personas, jobs), adapt: adaptJobsRefinement,
  });
}

/** 3 more personas, then refine the jobs with them (new personas used to be locked by default). */
async function addMore(ctx: Ctx) {
  const { ai, data, brief } = ctx;
  const existing = data.of('persona').filter((p) => p.decision !== 'rejected');
  if (!brief || existing.length >= MAX_PERSONAS) return;
  const added = await ai.run('add', {
    route: '/api/ai/add-personas',
    body: {
      ...base(ctx),
      existing: existing.map(personaPayload),
      lockedIds: existing.filter((p) => p.decision === 'accepted').map((p) => p.id),
      feedback: buildFeedback(data.all, [{ node: 'users', type: 'persona' }], data.links),
    },
    node: 'users', inputs: inputsOf(brief.items, existing), adapt: adaptPersonaBatch,
  });
  if (!added.ok) return;
  const refined = await refine(ctx, [...data.context('users', 'persona'), ...added.result.created.filter(isPersona)]);
  if (!refined.ok && !refined.aborted) {
    ai.setError(`persona 已加入，但 Jobs 刷新失败：${refined.message} · 你可以稍后手动点刷新`);
  }
}

/** The AI actions of the users node: full analysis, refine jobs, 3 more personas. */
export function useUsersActions(data: NodeData, brief: BriefRequestContext | null) {
  const { slug } = useProject();
  const ai = useAiAction();
  const ctx: Ctx = { ai, data, brief, slug };

  const analyze = () => {
    if (!brief) return;
    void ai.run('analyze', {
      route: '/api/ai/analyze-users',
      body: { ...base(ctx), feedback: buildFeedback(data.all, [{ node: 'users', type: 'persona' }, { node: 'users', type: 'job' }], data.links) },
      node: 'users', inputs: inputsOf(brief.items), adapt: adaptUsersAnalysis,
    });
  };

  const refreshJobs = () => {
    const personas = data.context('users', 'persona');
    if (personas.length === 0) return ai.setError('请至少选中 1 个 persona，然后再刷新 Jobs');
    void refine(ctx, personas);
  };

  return { analyze, refreshJobs, addMore: () => void addMore(ctx), running: ai.running, error: ai.error };
}
