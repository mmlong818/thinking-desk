// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';

export const BriefExtractionSchema = z.object({
  highlights: z.array(
    z.object({
      text: z.string(),
      kind: z.enum(['fact', 'assumption', 'missing']),
      reason: z.string().optional(),
    }),
  ),
  fields: z.object({
    problem_statement: z.string().nullable(),
    target_user: z.string().nullable(),
    scenario: z.string().nullable(),
    value_prop: z.string().nullable(),
    success_criteria: z.string().nullable(),
    time_constraint: z.string().nullable(),
    boundaries: z.array(z.string()),
    /** 方法论 v2 §4.1 必含字段：道德红线（明确不得采用的手段）。 */
    red_lines: z.array(z.string()).default([]),
  }),
  follow_ups: z
    .array(
      z.object({
        field: z.string(),
        question: z.string(),
        why: z.string().optional(),
        /** 用户视角的多选候选答案，3-5 条；用户可勾选一项或多项，也可自由输入。 */
        options: z.array(z.string()).default([]),
      }),
    )
    .max(5),
  completeness: z.number().int().min(0).max(100),
});
export type BriefExtraction = z.infer<typeof BriefExtractionSchema>;
export interface ClarificationAnswer {
  question: string;
  answer: string | string[];
}
