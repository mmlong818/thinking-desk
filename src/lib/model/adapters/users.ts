import type { Job, JobsRefinement, Persona, PersonaBatch, UsersAnalysis } from '../../ai/schemas/analyze-users';
import type { ItemStance } from '../../ai/schemas/stance';
import type { ItemDraft } from '../repository';
import { critiqueDrafts, modelStance, recommend, scopes, summaryDraft, type AdaptedOutput } from './common';

export const JOB_DIMENSIONS = ['functional', 'emotional', 'social'] as const;

// Every persona (primary or candidate) carries the model's own verdict as aiStance; the AI's
// priority jobs are recommendations.
export const JOB_PRIORITY_REASON = 'AI 建议锁定为优先 · 每类 Job 最多 1 个';

/** The stance becomes aiStance (missing → neutral), not part of the body. */
export function personaDrafts(personas: ReadonlyArray<Persona & { stance: ItemStance }>): ItemDraft[] {
  return personas.map(({ stance, ...body }): ItemDraft => ({ ref: body.id, type: 'persona', body, aiStance: modelStance(stance) }));
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
