// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';

export const KanoKeys = ['must', 'performance', 'delight', 'indifferent', 'reverse'] as const;
export const KanoSchema = z.enum(KanoKeys);
export type KanoKind = z.infer<typeof KanoSchema>;

export const KANO_META: Record<
  KanoKind,
  { label: string; short: string; hint: string; cls: string }
> = {
  must:        { label: '基本型',   short: 'MUST',    hint: '没有用户愤怒、有了无感',          cls: 'must' },
  performance: { label: '期望型',   short: 'PERF',    hint: '越好越满意、线性关系',            cls: 'perf' },
  delight:     { label: '兴奋型',   short: 'DELIGHT', hint: '没有不失望、有了惊喜',            cls: 'delight' },
  indifferent: { label: '无差别',   short: 'MEH',     hint: '有没有无感 —— 优先砍掉',          cls: 'meh' },
  reverse:     { label: '反向型',   short: 'REV',     hint: '有人喜欢有人讨厌 —— 可控选项',    cls: 'reverse' },
};

export const RiceSchema = z.object({
  /** 每季度受影响的用户数绝对值 */
  reach: z.number().min(0),
  /** 0.25 | 0.5 | 1 | 2 | 3 */
  impact: z.number().min(0.25).max(3),
  /** 0.5 | 0.8 | 1.0 */
  confidence: z.number().min(0).max(1),
  /** 开发 + 设计 + 测试总人月 */
  effort: z.number().min(0.1),
});
export type RiceScore = z.infer<typeof RiceSchema>;

export const FiveQuestionsSchema = z.object({
  why_do: z.string(),          // §9.4 Q1 · 为什么要做
  why_this_way: z.string(),    // §9.4 Q2 · 为什么这么做
  alternatives: z.string(),    // §9.4 Q3 · 还能怎么做
  what_if_not: z.string(),     // §9.4 Q4 · 不做会怎样
  what_if_wrong: z.string(),   // §9.4 Q5 · 做错会怎样（最重要）
});

export const FeatureTracesSchema = z.object({
  insight_ids: z.array(z.string()).default([]),
  job_ids: z.array(z.string()).default([]),
  persona_ids: z.array(z.string()).default([]),
  scenario_ids: z.array(z.string()).default([]),
});

export const FeatureSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  /** 金字塔支柱 · 同层级最多 7 个 */
  pillar: z.string(),
  /** 可选的中层分组名 */
  group: z.string().optional().default(''),

  traces: FeatureTracesSchema,

  kano: KanoSchema,
  rice: RiceSchema,
  /** R × I × C ÷ E */
  rice_score: z.number(),

  five_questions: FiveQuestionsSchema,

  /** §9.5 功能卡片 = 假设 */
  core_hypothesis: z.string(),
  validation_metric: z.string(),
  failure_signal: z.string(),

  /** §十一 伦理前哨（更深审查在独立节点） */
  ethics_concern: z.string().optional().default(''),
  red_line_risk: z.boolean().default(false),

  suggested_priority: z.boolean().default(false),
});
export type Feature = z.infer<typeof FeatureSchema>;

export const PillarSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
});
export type Pillar = z.infer<typeof PillarSchema>;

export const NotDoingSchema = z.object({
  name: z.string(),
  reason: z.enum(['boundary', 'ethics', 'indifferent', 'low_rice', 'dependency']),
  why: z.string(),
});
export type NotDoing = z.infer<typeof NotDoingSchema>;

export const FeatureListSchema = z.object({
  pillars: z.array(PillarSchema).min(2).max(5),
  features: z.array(FeatureSchema).min(5),
  not_doing: z.array(NotDoingSchema).min(1),
  differentiation_echo: z.string(),
  critiques: z
    .array(
      z.object({
        kind: z.enum(['check', 'critique', 'ask']),
        title: z.string(),
        body: z.string(),
      }),
    )
    .max(6),
});
export type FeatureList = z.infer<typeof FeatureListSchema>;
