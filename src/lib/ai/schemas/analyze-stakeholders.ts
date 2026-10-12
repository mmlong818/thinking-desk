// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';

export const StakeholderSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  power: z.enum(['high', 'low']),
  interest: z.enum(['high', 'low']),
  note: z.string(),
  source: z.string(),
  /** Baseline stakeholders (sponsor, maker, business owner, compliance) are
   *  required — they stay selected and cannot be removed by the user. */
  required: z.boolean().default(false),
  category: z.enum([
    'sponsor',
    'maker',
    'business',
    'user',
    'compliance',
    'partner',
    'competitor',
    'other',
  ]),
  engagement_hint: z.string().optional().default(''),
});
export type Stakeholder = z.infer<typeof StakeholderSchema>;

export const EngagementPlanSchema = z.object({
  manage: z.string(),
  satisfy: z.string(),
  inform: z.string(),
  monitor: z.string(),
});
export type EngagementPlan = z.infer<typeof EngagementPlanSchema>;

export const StakeholdersAnalysisSchema = z.object({
  stakeholders: z.array(StakeholderSchema).min(5).max(15),
  engagement_plan: EngagementPlanSchema,
  priority_summary: z.string(),
  critiques: z
    .array(
      z.object({
        kind: z.enum(['check', 'critique', 'ask']),
        title: z.string(),
        body: z.string(),
      }),
    )
    .max(5),
});
export type StakeholdersAnalysis = z.infer<typeof StakeholdersAnalysisSchema>;
