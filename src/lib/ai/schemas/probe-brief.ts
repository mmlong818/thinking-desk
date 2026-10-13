// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';

export const ProbeTurnSchema = z.object({
  question: z.string(),
  answer: z.string(),
  field_tag: z.string().optional(),
});
export type ProbeTurn = z.infer<typeof ProbeTurnSchema>;

export const ProbeResultSchema = z.union([
  z.object({
    action: z.literal('question'),
    /** 当前要问用户的下一个问题 */
    question: z.string(),
    /** 绑定到 Brief 哪个字段（problem_statement / target_user / scenario / ...） */
    field_tag: z.string(),
    /** 为什么问这个，展示在问题下方 */
    why: z.string(),
    /** 可选的提示性选项，用户可以点击快速填入 */
    hints: z.array(z.string()).default([]),
    /** 大概还剩几个问题（用户看得到进度） */
    remaining_estimate: z.number().int().min(0).max(10),
  }),
  z.object({
    action: z.literal('done'),
    /** 总结已收集到的关键信息 */
    summary: z.string(),
  }),
]);
export type ProbeResult = z.infer<typeof ProbeResultSchema>;
