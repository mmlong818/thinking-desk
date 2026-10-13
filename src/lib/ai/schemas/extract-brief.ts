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
    /** 方法论 v2 §4.1 必含字段：道德红线（明确不得采用的手段）。只放原文（含澄清回答）明确写明的。 */
    red_lines: z.array(z.string()).default([]),
  }),
  /**
   * 原文没写、AI 认为这个项目领域应该有的红线候选，各附依据。与 fields.red_lines 分开，
   * 让 AI 的推断不冒充 Brief 的原话；两者都成为 `red_line` 条目，采纳后下游一视同仁。
   */
  inferred_red_lines: z.array(z.object({ text: z.string(), reason: z.string() })).default([]),
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
/** One answered clarify-questionnaire question (request input, also stored on the brief). */
export const ClarificationAnswerSchema = z.object({
  question: z.string(),
  answer: z.union([z.string(), z.array(z.string())]),
});
export type ClarificationAnswer = z.infer<typeof ClarificationAnswerSchema>;
