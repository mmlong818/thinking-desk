'use client';

import { useState } from 'react';
import { useProject } from '@/components/project/ProjectStore';
import { useAiAction, type AiActionState } from '@/components/project/useAiAction';
import { confirmSingletonOverwrite } from '@/components/shared/NodeKit';
import type { ClarifyResult } from '@/lib/ai/schemas/clarify-brief';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/schemas/extract-brief';
import type { ProbeResult, ProbeTurn } from '@/lib/ai/schemas/probe-brief';
import { adaptExtractBrief } from '@/lib/model/adapters';
import type { ItemOfType } from '@/lib/model/context';
import type { Stage } from './brief-meta';

// The brief's clarification flow: clarify → (questionnaire | interview) → extract. Clarify and
// probe are process steps (their runs are recorded, nothing becomes an item); extract writes
// the brief singleton, red lines and assumptions through the adapter.

const SKIPPED_TURN = '（跳过）';

interface Ctx {
  ai: AiActionState;
  slug: string;
  rawText: string;
  setFlow: (s: Stage | null) => void;
}

type InterviewStage = Extract<Stage, { kind: 'interview' }>;

async function extract(ctx: Ctx, answers: ClarificationAnswer[], onFail: Stage) {
  ctx.setFlow({ kind: 'extracting' });
  const { rawText } = ctx;
  const out = await ctx.ai.run<BriefExtraction>('extract', {
    route: '/api/ai/extract-brief',
    body: { projectSlug: ctx.slug, rawText, answers },
    node: 'brief',
    inputs: [],
    adapt: (data) => adaptExtractBrief(data, { rawText, answers }),
  });
  ctx.setFlow(out.ok || out.aborted ? null : onFail);
}

async function clarify(ctx: Ctx) {
  ctx.setFlow({ kind: 'clarifying' });
  const out = await ctx.ai.run<ClarifyResult>('clarify', {
    route: '/api/ai/clarify-brief', body: { rawText: ctx.rawText }, node: 'brief', inputs: [],
  });
  if (!out.ok) return ctx.setFlow({ kind: 'paste' });
  if (out.data.action === 'proceed') return extract(ctx, [], { kind: 'paste' });
  ctx.setFlow({ kind: 'mode_choose', ask: out.data });
}

const turnsToAnswers = (history: ProbeTurn[]): ClarificationAnswer[] =>
  history.filter((t) => t.answer !== SKIPPED_TURN).map((t) => ({ question: t.question, answer: t.answer }));

function finish(ctx: Ctx, stage: InterviewStage, history: ProbeTurn[]) {
  if (history.length === 0) return;
  void extract(ctx, turnsToAnswers(history), { ...stage, history, current: null, probing: false });
}

async function probe(ctx: Ctx, reasoning: string, history: ProbeTurn[]) {
  const stage: InterviewStage = { kind: 'interview', reasoning, history, current: null, probing: true };
  ctx.setFlow(stage);
  const out = await ctx.ai.run<ProbeResult>('probe', {
    route: '/api/ai/probe-brief', body: { rawText: ctx.rawText, history }, node: 'brief', inputs: [],
  });
  if (!out.ok) return ctx.setFlow(history.length > 0 ? { ...stage, probing: false } : { kind: 'paste' });
  if (out.data.action === 'done') {
    // Nothing (more) to ask: extract with what was answered so far.
    return history.length > 0 ? finish(ctx, stage, history) : void extract(ctx, [], { kind: 'paste' });
  }
  ctx.setFlow({ ...stage, current: out.data, probing: false });
}

function answer(ctx: Ctx, stage: Stage, text: string) {
  if (stage.kind !== 'interview' || !stage.current) return;
  const turn: ProbeTurn = { question: stage.current.question, answer: text, field_tag: stage.current.field_tag };
  void probe(ctx, stage.reasoning, [...stage.history, turn]);
}

export function useBriefFlow(brief: ItemOfType<'brief'> | undefined, rawText: string) {
  const { slug } = useProject();
  const ai = useAiAction();
  const [flow, setFlow] = useState<Stage | null>(null);
  const stage: Stage = flow ?? (brief ? { kind: 'done' } : { kind: 'paste' });
  const ctx: Ctx = { ai, slug, rawText, setFlow };
  return {
    stage,
    error: ai.error,
    start: () => {
      if (!rawText.trim() || !confirmSingletonOverwrite(brief, 'Brief')) return;
      void clarify(ctx);
    },
    pickMode: (mode: 'questionnaire' | 'interview') => {
      if (stage.kind !== 'mode_choose') return;
      const { ask } = stage;
      if (mode === 'questionnaire') {
        return setFlow({ kind: 'ask', questions: ask.questions, reasoning: ask.reasoning, needType: ask.need_type });
      }
      void probe(ctx, ask.reasoning, []);
    },
    answer: (text: string) => answer(ctx, stage, text),
    skipCurrent: () => answer(ctx, stage, SKIPPED_TURN),
    finishInterview: () => stage.kind === 'interview' && finish(ctx, stage, stage.history),
    submitAnswers: (answers: ClarificationAnswer[]) => void extract(ctx, answers, stage),
    skipClarifier: () => void extract(ctx, [], { kind: 'paste' }),
    reset: () => setFlow({ kind: 'paste' }),
  };
}
