// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';
import { StanceField } from './stance';

export const DIMENSION_KEYS = [
  'time',
  'place',
  'people',
  'trigger',
  'process',
  'tools',
  'conditions',
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_META: Record<DimensionKey, { label: string; hint: string }> = {
  time:       { label: '时间', hint: '清晨 / 通勤 / 午休 / 加班 / 睡前' },
  place:      { label: '地点', hint: '家里 / 办公室 / 地铁 / 咖啡馆 / 户外' },
  people:     { label: '人物', hint: '独自 / 有家人 / 有同事 / 有陌生人' },
  trigger:    { label: '起因', hint: '心理状态 / 外部事件 / 生理需要' },
  process:    { label: '过程', hint: '一步步发生了什么（v2 新增）' },
  tools:      { label: '道具', hint: '手机 / 电脑 / 纸笔 / 其他产品' },
  conditions: { label: '条件', hint: '没网 / 电量低 / 嘈杂 / 昏暗 / 时间紧迫' },
};

export const ElementSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** AI 打分：这个候选对项目多相关（>Brief/Jobs 推断） */
  relevance: z.enum(['high', 'medium', 'low']).default('medium'),
});
export type ScenarioElement = z.infer<typeof ElementSchema>;

export const DimensionsResultSchema = z.object({
  dimensions: z.object({
    time:       z.array(ElementSchema).min(6).max(12),
    place:      z.array(ElementSchema).min(6).max(12),
    people:     z.array(ElementSchema).min(6).max(12),
    trigger:    z.array(ElementSchema).min(6).max(12),
    process:    z.array(ElementSchema).min(6).max(12),
    tools:      z.array(ElementSchema).min(6).max(12),
    conditions: z.array(ElementSchema).min(6).max(12),
  }),
});
export type DimensionsResult = z.infer<typeof DimensionsResultSchema>;
export const ScenarioDraftSchema = z.object({
  id: z.string(),
  title: z.string(),
  meta: z.string(),
  narrative: z.string(),
  /** 引用的 element id 列表，用于溯源 */
  element_ids: z.array(z.string()).min(3),
  /** 这个情景服务哪些 Jobs */
  job_ids: z.array(z.string()).default([]),
  /** 隐约感受到的痛点（粗略，Stage 3 会深入） */
  pain_hint: z.string(),
});
export type ScenarioDraft = z.infer<typeof ScenarioDraftSchema>;

export const ScenarioDraftsSchema = z.object({
  scenarios: z.array(ScenarioDraftSchema).min(5).max(8),
});
export type ScenarioDrafts = z.infer<typeof ScenarioDraftsSchema>;
export const PainPointSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  moment: z.string(),
  feeling: z.string(),
  /** §8.4 连续追问 3 层"为什么"。why_1 是第一次追问，why_3 最底层 */
  why_1: z.string(),
  why_2: z.string(),
  why_3: z.string(),
  root_cause: z.string(),
});
export type PainPoint = z.infer<typeof PainPointSchema>;

export const DelightPointSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  moment: z.string(),
  feeling: z.string(),
  /** 用户真正被打动的深层理由 */
  root_reason: z.string(),
  /** 产品可抓住的创新机会 */
  opportunity: z.string(),
});
export type DelightPoint = z.infer<typeof DelightPointSchema>;

export const MatrixCellSchema = z.object({
  scenario_id: z.string(),
  job_id: z.string(),
  frequency: z.enum(['high', 'medium', 'low']),
  importance: z.enum(['high', 'medium', 'low']),
  /** §8.2 三种格子分类 */
  category: z.enum(['core', 'safety_net', 'fringe']),
  note: z.string(),
});
export type MatrixCell = z.infer<typeof MatrixCellSchema>;

export const ExtremeScenarioSchema = z.object({
  id: z.string(),
  dim: z.enum([...DIMENSION_KEYS]),
  pushed_to_limit: z.string(),
  description: z.string(),
  robustness_gap: z.string(),
});
export type ExtremeScenario = z.infer<typeof ExtremeScenarioSchema>;

export const HostileScenarioSchema = z.object({
  id: z.string(),
  attack: z.string(),
  vulnerable_users: z.string(),
  mitigation: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
});
export type HostileScenario = z.infer<typeof HostileScenarioSchema>;

export const DesignInsightSchema = z.object({
  id: z.string(),
  /** §8.5 固定格式：在 [情景] 下，[用户] 想完成 [Job]，他的痛点是 [XX]，因此我们可以 [动作] */
  scenario_id: z.string(),
  job_id: z.string().optional(),
  pain_id: z.string().optional(),
  insight_text: z.string(),
  action: z.string(),
});
export type DesignInsight = z.infer<typeof DesignInsightSchema>;

export const ScenarioDeepAnalysisSchema = z.object({
  matrix: z.array(MatrixCellSchema),
  // Extremes, hostiles, pain points and insights carry the AI's verdict; the item bodies above stay stance-free.
  extremes: z.array(ExtremeScenarioSchema.extend({ stance: StanceField })).min(3).max(8),
  hostiles: z.array(HostileScenarioSchema.extend({ stance: StanceField })).min(2).max(6),
  pain_points: z.array(PainPointSchema.extend({ stance: StanceField })).min(3),
  delight_points: z.array(DelightPointSchema),
  design_insights: z.array(DesignInsightSchema.extend({ stance: StanceField })).min(3).max(10),
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
export type ScenarioDeepAnalysis = z.infer<typeof ScenarioDeepAnalysisSchema>;
