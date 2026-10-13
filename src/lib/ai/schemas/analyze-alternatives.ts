// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';
import { StanceField } from './stance';

export const AlternativeSchema = z.object({
  id: z.string(),
  name: z.string(),
  category: z.enum(['direct', 'indirect', 'non_consumption']),
  /** 它是什么 / 用户怎么做 */
  description: z.string(),
  /** 用户为什么用它 —— 解决哪个 Job */
  why_users_use: z.string(),
  /** 威胁级别 · 对我们要打的目标用户/Job 多大挑战 */
  threat_level: z.enum(['high', 'medium', 'low']),
  /** 搜索来源链接（可能多个，数组；没搜到则空数组） */
  sources: z.array(z.string()).default([]),
});
export type Alternative = z.infer<typeof AlternativeSchema>;

export const StrategicProfileSchema = z.object({
  alt_id: z.string(),
  /** §7.2 Q1：他们承诺了什么 · 不超过 15 字 */
  promise: z.string(),
  /** §7.2 Q2：赢利模式 */
  revenue_model: z.string(),
  /** §7.2 Q3：护城河 */
  moat: z.string(),
  moat_strength: z.enum(['strong', 'medium', 'weak']),
});
export type StrategicProfile = z.infer<typeof StrategicProfileSchema>;

export const FeatureBreakdownSchema = z.object({
  alt_id: z.string(),
  /** §7.3 四个角度 */
  menu_structure: z.array(z.string()),
  core_flows: z.array(z.string()),
  key_interactions: z.array(z.string()),
  headline_features: z.array(z.string()),
});
export type FeatureBreakdown = z.infer<typeof FeatureBreakdownSchema>;

export const AlternativesAnalysisSchema = z.object({
  alternatives: z.array(AlternativeSchema).min(6).max(15),
  strategic_profiles: z.array(StrategicProfileSchema).min(2).max(6),
  feature_breakdowns: z.array(FeatureBreakdownSchema).max(4),
  differentiation_hypothesis: z.string(),
  /** The AI's verdict on the hypothesis; the `diff_hypothesis` item body stays stance-free. */
  differentiation_stance: StanceField,
  key_threats: z.array(z.string()).min(1).max(5),
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
export type AlternativesAnalysis = z.infer<typeof AlternativesAnalysisSchema>;
