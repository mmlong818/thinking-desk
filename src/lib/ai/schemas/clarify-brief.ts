// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';

export const QuestionSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  subtitle: z.string().optional().default(''),
  type: z.enum(['single', 'multi']),
  options: z.array(z.string().min(1)).min(3).max(6),
});
export type BriefQuestion = z.infer<typeof QuestionSchema>;

export const ClarifyResultSchema = z.union([
  z.object({
    action: z.literal('proceed'),
    reason: z.string().min(1),
  }),
  z.object({
    action: z.literal('ask'),
    need_type: z.enum(['design', 'product', 'mixed', 'other']),
    /** v2 方法论：两种澄清模式。
     *  - questionnaire：一次抛 7-9 道选择题，适合信息密度高、只缺局部细节的情况
     *  - interview：一问一答追问，适合原文很模糊、需要通过 §5.3 访谈法还原真实场景 */
    suggested_mode: z.enum(['questionnaire', 'interview']).default('questionnaire'),
    mode_reason: z.string().default(''),
    reasoning: z.string().min(1),
    questions: z.array(QuestionSchema).min(1).max(12),
  }),
]);
export type ClarifyResult = z.infer<typeof ClarifyResultSchema>;
