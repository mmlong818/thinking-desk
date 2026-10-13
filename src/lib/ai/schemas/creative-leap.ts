// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';

export const FirstPrincipleRethinkSchema = z.object({
  id: z.string(),
  /** 当前行业默认的假设 · 例如"锂电池必须贵" */
  industry_assumption: z.string(),
  /** 把它拆到物理 / 底层规律 · 例如"原料价其实只占 15%" */
  physical_floor: z.string(),
  /** 由此推出的新设计机会 */
  opportunity: z.string(),
  /** 可信度 0-3：这条反转在本项目里能落地吗？ */
  feasibility: z.enum(['low', 'medium', 'high']),
});
export type FirstPrincipleRethink = z.infer<typeof FirstPrincipleRethinkSchema>;

export const AnalogyTransferSchema = z.object({
  id: z.string(),
  /** 我们项目的本质问题（不是表层） · 例"本质是撮合" */
  core_essence: z.string(),
  /** 借鉴的源领域 */
  source_domain: z.string(),
  /** 源领域的成熟解法 · 例"做市商 + 集中撮合引擎" */
  source_mechanism: z.string(),
  /** 迁移后的具体动作 */
  transferred_mechanism: z.string(),
  /** 哪些要适配 / 哪些搬不过来 */
  adaptation_notes: z.string(),
  feasibility: z.enum(['low', 'medium', 'high']),
});
export type AnalogyTransfer = z.infer<typeof AnalogyTransferSchema>;

export const ConstraintFlipSchema = z.object({
  id: z.string(),
  /** 类型：去掉 / 加一个 / 反转目标 */
  flip_type: z.enum(['remove_constraint', 'add_constraint', 'reverse_goal']),
  /** 原约束 · 例"用户必须注册账号" */
  original: z.string(),
  /** 反转后 · 例"如果用户不需要注册呢？" */
  flipped: z.string(),
  /** 反转暴露的可能性 */
  surprise: z.string(),
  /** 如果采纳，对当前功能列表的具体影响 */
  impact_on_features: z.string(),
  feasibility: z.enum(['low', 'medium', 'high']),
});
export type ConstraintFlip = z.infer<typeof ConstraintFlipSchema>;

export const LeapRecommendationSchema = z.object({
  /** AI 综合评估：项目适合做多大胆的跃迁
   * - bold：大胆跃迁（推翻多个常规假设，差异化显著）
   * - selective：精选跃迁（选 1-2 个关键点突破，其他保持常规）
   * - minimal：最小跃迁（仅做 1 个最保守的改造，但必须有改造）
   *
   * 注意：v2 方法论里虽然 §10.4 说"大部分项目不需要跃迁"，但**设计的意义正在跃迁处产生**。
   * 即便项目整体保守，也必须选出至少 1 条值得的跃迁——没有跃迁就是"交付常规方案"，不是"设计"。
   */
  timing_verdict: z.enum(['bold', 'selective', 'minimal']),
  timing_reason: z.string(),
  /** 挑出来最值得采纳的 1-3 条跃迁 · 来自上面任一类 · 至少 1 条 */
  top_picks: z.array(
    z.object({
      source_method: z.enum(['first_principles', 'analogy', 'constraint_flip']),
      source_id: z.string(),
      why: z.string(),
      /** 采纳这条意味着功能列表要怎么改 */
      required_changes: z.array(z.string()),
    }),
  ).min(1),
});
export type LeapRecommendation = z.infer<typeof LeapRecommendationSchema>;

export const CreativeLeapAnalysisSchema = z.object({
  first_principles: z.array(FirstPrincipleRethinkSchema).min(4).max(8),
  analogies:        z.array(AnalogyTransferSchema).min(4).max(8),
  constraint_flips: z.array(ConstraintFlipSchema).min(6).max(12),
  recommendation:   LeapRecommendationSchema,
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
export type CreativeLeapAnalysis = z.infer<typeof CreativeLeapAnalysisSchema>;
export const LEAP_CATEGORIES = ['first_principles', 'analogies', 'constraint_flips'] as const;
export type LeapCategory = (typeof LEAP_CATEGORIES)[number];

export const MoreItemsResultSchema = z.object({
  first_principles: z.array(FirstPrincipleRethinkSchema).optional(),
  analogies: z.array(AnalogyTransferSchema).optional(),
  constraint_flips: z.array(ConstraintFlipSchema).optional(),
});
export type MoreItemsResult = z.infer<typeof MoreItemsResultSchema>;

/** What a "give me more" run must return for the requested category (2-4 new items). */
export const MORE_ITEMS_SCHEMAS = {
  first_principles: z.object({ first_principles: z.array(FirstPrincipleRethinkSchema).min(2).max(4) }),
  analogies: z.object({ analogies: z.array(AnalogyTransferSchema).min(2).max(4) }),
  constraint_flips: z.object({ constraint_flips: z.array(ConstraintFlipSchema).min(2).max(4) }),
} satisfies Record<LeapCategory, z.ZodType<MoreItemsResult>>;
