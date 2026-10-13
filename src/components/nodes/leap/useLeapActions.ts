'use client';

import { useProject } from '@/components/project/ProjectStore';
import { useAiAction, type AiActionState } from '@/components/project/useAiAction';
import type { NodeData } from '@/components/project/useNodeData';
import { summaryText } from '@/components/shared/copilot-cards';
import type { FeatureRevision } from '@/lib/ai/schemas/revise-features';
import { adaptFeatureRevision, adaptLeapAnalysis, adaptMoreLeapItems } from '@/lib/model/adapters';
import { inputsOf, type BriefRequestContext } from '@/lib/model/context';
import { buildFeedback } from '@/lib/model/feedback';
import { briefPayload, jobPayload, personaPayload } from '@/lib/store/request-context';
import { CATEGORY_OF, LEAP_TYPES, type LeapItem, type LeapType } from './leap-meta';

interface Ctx {
  ai: AiActionState;
  data: NodeData;
  brief: BriefRequestContext;
  slug: string;
}

const featureDigest = (f: Extract<NodeData['all'][number], { type: 'feature' }>) => ({
  id: f.id, name: f.body.name, description: f.body.description, pillar: f.body.pillar, kano: f.body.kano,
  rice_score: f.body.rice_score, core_hypothesis: f.body.core_hypothesis, validation_metric: f.body.validation_metric,
});

/** Brief, personas, jobs, the conventional feature list and the differentiation hypothesis. */
function leapContext({ data, brief, slug }: Ctx) {
  const personas = data.context('users', 'persona');
  const jobs = data.context('users', 'job');
  const features = data.context('feat', 'feature');
  const diff = data.context('alt', 'diff_hypothesis')[0];
  return {
    body: {
      projectSlug: slug, ...briefPayload(brief),
      personas: personas.map(personaPayload),
      lockedJobs: jobs.map((j) => jobPayload(j, data.links)),
      features: features.map(featureDigest),
      ...(diff ? { differentiation_hypothesis: diff.body.statement, alt_threats: diff.body.key_threats } : {}),
    },
    inputs: inputsOf(brief.items, personas, jobs, features, diff ? [diff] : []),
    features,
  };
}

const liveLeaps = (data: NodeData): LeapItem[] =>
  LEAP_TYPES.flatMap((t) => data.of(t)).filter((l) => l.decision !== 'rejected') as LeapItem[];

function leapSnapshot(leaps: LeapItem[]) {
  const of = <T extends LeapType>(t: T) => leaps.filter((l): l is Extract<LeapItem, { type: T }> => l.type === t);
  return {
    first_principles: of('first_principle').map((l) => ({ id: l.id, ...l.body })),
    analogies: of('analogy').map((l) => ({ id: l.id, ...l.body })),
    constraint_flips: of('constraint_flip').map((l) => ({ id: l.id, ...l.body })),
  };
}

function revise(ctx: Ctx) {
  const { data, ai } = ctx;
  const picked = liveLeaps(data).filter((l) => l.decision === 'accepted');
  const { body, inputs, features } = leapContext(ctx);
  if (picked.length === 0) return ai.setError('至少选中 1 条跃迁才能应用到功能列表');
  if (features.length === 0) return ai.setError('没找到功能列表 · 请先完成 06 节点');
  const pillars = data.of('pillar', 'feat').filter((p) => p.decision !== 'rejected');
  const scope = (['feature', 'pillar', 'not_doing'] as const).map((type) => ({ node: 'final' as const, type }));
  void ai.run<FeatureRevision>('revise', {
    route: '/api/ai/revise-features',
    body: {
      ...body,
      original: {
        features: features.map(featureDigest),
        pillars: pillars.map((p) => ({ id: p.id, ...p.body })),
        differentiation_echo: summaryText(data.of('summary', 'feat'), 'differentiation_echo'),
      },
      leaps: leapSnapshot(liveLeaps(data)),
      selectedLeapIds: picked.map((l) => l.id),
      feedback: buildFeedback(data.all, scope),
    },
    node: 'final',
    inputs: [...inputs, ...inputsOf(picked)],
    adapt: (out) => adaptFeatureRevision(out, { originalFeatureIds: features.map((f) => f.id) }),
  });
}

/** Initial analysis, "3 more" per method, and applying the accepted leaps to the feature list. */
export function useLeapActions(data: NodeData, brief: BriefRequestContext | null) {
  const { slug } = useProject();
  const ai = useAiAction();
  const ctx: Ctx | null = brief ? { ai, data, brief, slug } : null;
  const types = LEAP_TYPES.map((type) => ({ node: 'leap' as const, type }));
  return {
    running: ai.running,
    error: ai.error,
    run: () => {
      if (!ctx) return;
      const { body, inputs } = leapContext(ctx);
      void ai.run('analyze', {
        route: '/api/ai/creative-leap', body: { action: 'initial', ...body, feedback: buildFeedback(data.all, types) },
        node: 'leap', inputs, adapt: adaptLeapAnalysis,
      });
    },
    more: (type: LeapType) => {
      if (!ctx) return;
      const { body, inputs } = leapContext(ctx);
      const existing = data.of(type).filter((l) => l.decision !== 'rejected').map((l) => ({ id: l.id, ...l.body }));
      void ai.run(`more:${type}`, {
        route: '/api/ai/creative-leap',
        body: { action: 'more', category: CATEGORY_OF[type], existing, ...body, feedback: buildFeedback(data.all, [{ node: 'leap', type }]) },
        node: 'leap', inputs, adapt: adaptMoreLeapItems,
      });
    },
    revise: () => ctx && revise(ctx),
  };
}
