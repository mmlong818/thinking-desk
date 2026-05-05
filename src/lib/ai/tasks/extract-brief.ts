import { z } from 'zod';
import { runAi } from '../router';

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

const JSON_SCHEMA = {
  type: 'object',
  required: ['highlights', 'fields', 'follow_ups', 'completeness'],
  properties: {
    highlights: {
      type: 'array',
      items: {
        type: 'object',
        required: ['text', 'kind'],
        properties: {
          text: { type: 'string' },
          kind: { type: 'string', enum: ['fact', 'assumption', 'missing'] },
          reason: { type: 'string' },
        },
      },
    },
    fields: {
      type: 'object',
      required: [
        'problem_statement', 'target_user', 'scenario', 'value_prop',
        'success_criteria', 'time_constraint', 'boundaries', 'red_lines',
      ],
      properties: {
        problem_statement: { type: ['string', 'null'] },
        target_user: { type: ['string', 'null'] },
        scenario: { type: ['string', 'null'] },
        value_prop: { type: ['string', 'null'] },
        success_criteria: { type: ['string', 'null'] },
        time_constraint: { type: ['string', 'null'] },
        boundaries: { type: 'array', items: { type: 'string' } },
        red_lines: { type: 'array', items: { type: 'string' } },
      },
    },
    follow_ups: {
      type: 'array',
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
    },
    completeness: { type: 'integer', minimum: 0, maximum: 100 },
  },
};

const SYSTEM_PROMPT = `你是「思考工作台」的 AI 副驾驶。用户刚粘贴了一段原始需求文字（通常是老板的会议纪要或口头描述）。
你的任务是把这段文字结构化为 Brief，并标注其中哪些是事实、哪些是假设、哪些是缺失。

规则：
1. highlights 里每一条 text 必须是原文里的**逐字片段**（不要改写）。
   - fact：原文明确说过的客观陈述
   - assumption：听起来像事实但没有证据支持，默默被作者相信的
   - missing：原文应该说但没说的（比如 deadline、成功标准、付费方、边界）。
     missing 的 text 用占位符表示，例如「〔deadline 未明确〕」。
2. fields 是八项结构化 Brief：problem_statement / target_user / scenario / value_prop /
   success_criteria / time_constraint / boundaries / red_lines。
   - 只填原文有的或可直接推断的；信息不足就填 null。
   - boundaries 是"本次能力边界之外、这次不做"的列表（数组），没有则 []。
   - red_lines 是"无论商业诱惑多大都明确不做的道德红线"（方法论 v2 §4.1 硬性要求）。
     举例：不收集未成年人生物信息 / 不默认开启付费订阅 / 不使用情绪操纵式推送 /
     不在未经同意情况下分享数据 / 不使用虚假紧迫感。
     如果原文没提到红线但项目领域明显需要（K12 / 金融 / 医疗 / UGC 等），
     请**主动补 2-3 条适合本项目的红线候选**（写进 red_lines 数组）。
3. follow_ups 最多 5 条，优先追问 missing 里最关键的（成功标准 > 道德红线 > 付费方 > deadline > 边界）。
   - 每条必须指向一个 field，问题要具体，不要泛泛。
   - 每条**必须**给 3-5 个候选答案 options：
     - 用**用户口吻**写，像产品人脑里第一反应，不是合规清单
     - 形态多样：有的写**人**（"创始人自己"）、有的写**场景**（"项目评审前一晚"）、有的写**后果**（"被导师当场质疑"）、有的写**指标**（"次日留存 ≥ 40%"）
     - 避免"不能 X / 不要 X / 不允许 X"的并列条款式列表（合规文档语气）
     - 每条 ≤ 20 字，是一个具体画面 / 具体担忧 / 具体数字
     - 用户可勾选一项或多项，也可以自己写——options 是帮用户**想到**，不是替他想完
4. completeness 是 0-100 的整数，按照 fields 里非空字段的比例估算。
   - 8 个字段里填了 5 个且 boundaries + red_lines 非空 ≈ 70。

务必：只输出 JSON，不要任何前后文。`;

export interface ClarificationAnswer {
  question: string;
  answer: string | string[];
}

function formatClarifications(answers?: ClarificationAnswer[]): string {
  if (!answers || answers.length === 0) return '';
  const lines = answers.map((a) => {
    const val = Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer;
    return `- ${a.question}：${val}`;
  });
  return `\n\n用户在澄清问卷里的选择（请把这些作为事实处理，不再标记为假设）：\n${lines.join('\n')}`;
}

export async function extractBrief(
  rawText: string,
  answers?: ClarificationAnswer[],
  override?: string,
): Promise<BriefExtraction> {
  const clarification = formatClarifications(answers);
  const res = await runAi({
    task: 'BRIEF_EXTRACT',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: `原始文字：\n\n${rawText}${clarification}` },
    ],
    schema: JSON_SCHEMA,
    maxTokens: 8000,
    temperature: 0.2,
    override,
  });
  return BriefExtractionSchema.parse(res.data);
}
