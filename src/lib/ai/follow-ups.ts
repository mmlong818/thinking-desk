import { z } from 'zod';

/**
 * 共享的"AI 追问"形态：每个节点 task 的输出都可以挂上 follow_ups[]，
 * 副驾驶面板会用 NodeFollowUpsRunner 逐题展示，每题给多选 options + 自由输入。
 *
 * field 字段是节点内的一个标识符（任意字符串），仅用作 answers 字典的 key。
 * 节点组件可选择把 answer 写回结构化 fields（Brief 那样），或仅作为补充记录展示。
 */
export const FollowUpItemSchema = z.object({
  field: z.string(),
  question: z.string(),
  why: z.string().optional(),
  options: z.array(z.string()).default([]),
});
export type FollowUpItem = z.infer<typeof FollowUpItemSchema>;

/** AI prompt 里的统一描述段，避免每个 task 各自写一遍。 */
export const FOLLOW_UPS_PROMPT_FRAGMENT = `**follow_ups（最多 5 条，必填字段，没有就给空数组）**：
   - 用来在副驾驶面板里逐题追问用户、补齐当前节点尚未明确的关键信息
   - 每条结构 { field, question, why?, options }：
     - field：本节点内的标识符，任意字符串（例如 "missing_metric"、"persona[0].pain"）
     - question：要问用户的问题，具体不泛泛，≤ 30 字
     - why：解释为什么要问（在什么决策上会用到这个答案），≤ 40 字
     - options：3-5 个用户口吻、形态多样（具体画面 / 担忧 / 数字 / 角色）的候选答案，每条 ≤ 20 字
       - **禁止**全是"不能 X / 不要 X"的并列条款式列表（合规文档语气）
       - **禁止**全是同形态排比，要混合（人 / 场景 / 后果 / 指标）
       - 用户可勾选一项或多项，也可以自己写 —— options 是帮用户**想到**，不是替他想完
   - 优先追问"决定下游节点能否落地"的关键缺失，而不是面面俱到`;

export const FOLLOW_UPS_SCHEMA_FRAGMENT = {
  type: 'array',
  maxItems: 5,
  items: {
    type: 'object',
    required: ['field', 'question'],
    properties: {
      field: { type: 'string' },
      question: { type: 'string' },
      why: { type: 'string' },
      options: { type: 'array', items: { type: 'string' }, maxItems: 5 },
    },
  },
};
