import type { Job, JobsRefinement, Persona, PersonaBatch, UsersAnalysis } from '../../ai/schemas/analyze-users';
import type { ItemDraft } from '../repository';
import { critiqueDrafts, neutral, recommend, scopes, summaryDraft, type AdaptedOutput } from './common';

export const JOB_DIMENSIONS = ['functional', 'emotional', 'social'] as const;

// The primary persona and the AI's priority jobs are recommendations; candidate personas stay
// neutral so "accept all recommended" does not simply select every persona.
export const PERSONA_REASON = {
  primary: 'AI 认为这是最典型的主用户',
  candidate: '与主用户互补的典型用户 · 产品通常要同时服务多个典型用户',
} as const;
export const JOB_PRIORITY_REASON = 'AI 建议锁定为优先 · 每类 Job 最多 1 个';

export function personaDrafts(personas: readonly Persona[]): ItemDraft[] {
  return personas.map((p) => ({
    ref: p.id, type: 'persona', body: p, aiStance: p.role === 'primary' ? recommend(PERSONA_REASON.primary) : neutral(PERSONA_REASON.candidate),
  }));
}

/** `persona_ids` stays on the raw body: the type registry turns it into derived_from Links. */
export function jobDrafts(jobs: Record<(typeof JOB_DIMENSIONS)[number], readonly Job[]>): ItemDraft[] {
  return JOB_DIMENSIONS.flatMap((dimension) =>
    jobs[dimension].map((j): ItemDraft => ({
      ref: j.id,
      type: 'job',
      body: { ...j, dimension },
      ...(j.suggested_priority ? { aiStance: recommend(JOB_PRIORITY_REASON) } : {}),
    })),
  );
}

/** USERS_JTBD (initial analysis): regenerates personas, jobs, the priority summary and critiques. */
export function adaptUsersAnalysis(out: UsersAnalysis): AdaptedOutput {
  return {
    drafts: [
      ...personaDrafts(out.personas),
      ...jobDrafts(out.jobs),
      ...summaryDraft('priority', out.priority_summary),
      ...critiqueDrafts(out.critiques),
    ],
    replace: scopes('users', 'persona', 'job', 'summary', 'critique'),
  };
}

/** USERS_JTBD (refine jobs): echoed accepted jobs are kept, unjudged ones rewritten or retired. */
export function adaptJobsRefinement(out: JobsRefinement): AdaptedOutput {
  return {
    drafts: [...jobDrafts(out.jobs), ...summaryDraft('priority', out.priority_summary), ...critiqueDrafts(out.critiques)],
    replace: scopes('users', 'job', 'summary', 'critique'),
  };
}

/** USERS_JTBD (3 more personas): additive. */
export function adaptPersonaBatch(out: PersonaBatch): AdaptedOutput {
  return { drafts: personaDrafts(out.personas), replace: [] };
}
