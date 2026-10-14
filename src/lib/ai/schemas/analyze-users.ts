// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';
import { StanceField } from './stance';

export const PersonaSchema = z.object({
  id: z.string(),
  /** 保留字段：AI 可以给首个角色打 primary、其余 candidate；用户可以重新指定。 */
  role: z.enum(['primary', 'candidate']),
  name: z.string(),
  one_liner: z.string(),
  meta: z.string(),
  story: z.string(),
  pain: z.string(),
});
export type Persona = z.infer<typeof PersonaSchema>;

/** A persona as the model outputs it: the body plus its own verdict (adapters move it to aiStance). */
const StancedPersonaSchema = PersonaSchema.extend({ stance: StanceField });

export const JobSchema = z.object({
  id: z.string(),
  title: z.string(),
  reach: z.number().int().min(1).max(10),
  impact: z.number().int().min(1).max(3),
  source: z.string(),
  /** AI suggestion flag — true means this Job should be locked as priority. */
  suggested_priority: z.boolean().default(false),
  /** Which personas (by id) primarily experience this Job. */
  persona_ids: z.array(z.string()).default([]),
});
export type Job = z.infer<typeof JobSchema>;

export const JobsRefinementSchema = z.object({
  jobs: z.object({
    functional: z.array(JobSchema).min(1),
    emotional: z.array(JobSchema).min(1),
    social: z.array(JobSchema).min(0),
  }),
  priority_summary: z.string(),
  critiques: z
    .array(z.object({ kind: z.enum(['check', 'critique', 'ask']), title: z.string(), body: z.string() }))
    .max(5),
});
export type JobsRefinement = z.infer<typeof JobsRefinementSchema>;

export const UsersAnalysisSchema = z.object({
  personas: z.array(StancedPersonaSchema).min(1).max(10),
  jobs: z.object({
    functional: z.array(JobSchema).min(1),
    emotional: z.array(JobSchema).min(1),
    social: z.array(JobSchema).min(0),
  }),
  priority_summary: z.string(),
  critiques: z
    .array(z.object({ kind: z.enum(['check', 'critique', 'ask']), title: z.string(), body: z.string() }))
    .max(5),
});
export type UsersAnalysis = z.infer<typeof UsersAnalysisSchema>;

export const PersonaBatchSchema = z.object({
  personas: z.array(StancedPersonaSchema).min(1).max(3),
});
export type PersonaBatch = z.infer<typeof PersonaBatchSchema>;
