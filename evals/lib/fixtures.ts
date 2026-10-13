import type { z } from 'zod';
import { AlternativesAnalysisSchema } from '../../src/lib/ai/schemas/analyze-alternatives';
import { DimensionsResultSchema, ScenarioDeepAnalysisSchema, ScenarioDraftsSchema } from '../../src/lib/ai/schemas/analyze-scenarios';
import { StakeholdersAnalysisSchema } from '../../src/lib/ai/schemas/analyze-stakeholders';
import { JobsRefinementSchema, PersonaBatchSchema, UsersAnalysisSchema } from '../../src/lib/ai/schemas/analyze-users';
import { ClarifyResultSchema } from '../../src/lib/ai/schemas/clarify-brief';
import { ConsistencyCheckSchema } from '../../src/lib/ai/schemas/consistency-check';
import { CreativeLeapAnalysisSchema, MORE_ITEMS_SCHEMAS } from '../../src/lib/ai/schemas/creative-leap';
import { DeriveFollowUpsResultSchema } from '../../src/lib/ai/schemas/derive-follow-ups';
import { FeatureListSchema } from '../../src/lib/ai/schemas/draft-features';
import { BriefExtractionSchema } from '../../src/lib/ai/schemas/extract-brief';
import { DesignProposalSchema } from '../../src/lib/ai/schemas/generate-design';
import { ProbeResultSchema } from '../../src/lib/ai/schemas/probe-brief';
import { FeatureRevisionSchema } from '../../src/lib/ai/schemas/revise-features';
import { SubfeatureBreakdownSchema } from '../../src/lib/ai/schemas/split-subfeatures';
import { validAlternatives } from '../../src/lib/ai/schemas/__fixtures__/alternatives';
import { validClarifyAsk, validClarifyProceed } from '../../src/lib/ai/schemas/__fixtures__/clarify-brief';
import { emptyConsistencyCheck, validConsistencyCheck } from '../../src/lib/ai/schemas/__fixtures__/consistency-check';
import { validLeap, validMoreItems } from '../../src/lib/ai/schemas/__fixtures__/creative-leap';
import { validFeatureList } from '../../src/lib/ai/schemas/__fixtures__/draft-features';
import { validBrief } from '../../src/lib/ai/schemas/__fixtures__/extract-brief';
import { validDesign } from '../../src/lib/ai/schemas/__fixtures__/generate-design';
import { validProbeDone, validProbeQuestion } from '../../src/lib/ai/schemas/__fixtures__/probe-brief';
import { validRevision } from '../../src/lib/ai/schemas/__fixtures__/revise-features';
import { validDeepAnalysis, validDimensions, validScenarioDrafts } from '../../src/lib/ai/schemas/__fixtures__/scenarios';
import { validBreakdown } from '../../src/lib/ai/schemas/__fixtures__/split-subfeatures';
import { validStakeholders } from '../../src/lib/ai/schemas/__fixtures__/stakeholders';
import { validJobsRefinement, validPersonaBatch, validUsers } from '../../src/lib/ai/schemas/__fixtures__/users';
import type { AiTask } from '../../src/lib/ai/types';
import type { StepName } from './chain';

// Canned task outputs for the offline evals: what the fake provider answers at each chain step
// (so every prompt renders without an API call) and, per task, the schema each fixture must pass.

const stance = (verdict: 'recommend' | 'neutral' | 'caution', reason: string) => ({ verdict, reason });

/** The design fixture in its current shape: every part with the model's own stance. */
export const designWithStances = {
  ...validDesign,
  overview_stance: stance('recommend', '定位与 Brief 一致'),
  principles_stance: stance('neutral', '原则可以，取舍待团队确认'),
  modules: validDesign.modules.map((m, i) => ({ ...m, stance: stance(i === 0 ? 'recommend' : 'caution', '依赖未定的数据来源') })),
  open_questions: [{ question: '要不要接第三方数据？', stance: stance('caution', '成本未评估') }],
};

export const breakdownWithStances = {
  ...validBreakdown,
  splits: validBreakdown.splits.map((s) => ({
    ...s, subfeatures: s.subfeatures.map((sf) => ({ ...sf, stance: stance('recommend', '设计案已定，可直接开工') })),
  })),
};

/** The brief in its current shape: red lines the text states, plus the ones the AI inferred with their basis. */
export const briefWithInferredRedLines = {
  ...validBrief,
  fields: { ...validBrief.fields, red_lines: ['不收集未成年人的生物信息'] },
  inferred_red_lines: [{ text: '不使用虚假紧迫感催促付费', reason: '面向未成年人的消费类产品常见的操纵手法' }],
};

export const alternativesWithStance = {
  ...validAlternatives,
  differentiation_stance: stance('neutral', '方向合理，能否成立取决于团队的数据资源'),
};

const first = <T extends object>(xs: T[], extra: object) => xs.map((x, i) => (i === 0 ? { ...x, ...extra } : x));

/** The deep analysis in its current shape: extremes, hostiles, pain points and insights carry the model's own stance. */
export const deepAnalysisWithStances = {
  ...validDeepAnalysis,
  extremes: validDeepAnalysis.extremes.map((x) => ({ ...x, stance: stance('recommend', '极值真会发生，当前方案会崩') })),
  hostiles: first(validDeepAnalysis.hostiles, { stance: stance('caution', '缓解措施依赖人工审核') }),
  pain_points: validDeepAnalysis.pain_points.map((p) => ({ ...p, stance: stance('recommend', '三层追问都有依据') })),
  design_insights: first(validDeepAnalysis.design_insights, { stance: stance('neutral', '值不值得做取决于优先级') }),
};

export const STEP_FIXTURES: Record<StepName, unknown> = {
  brief: briefWithInferredRedLines,
  users: validUsers,
  stake: validStakeholders,
  alt: alternativesWithStance,
  scen_exhaust: validDimensions,
  scen_combine: validScenarioDrafts,
  scen_deep: deepAnalysisWithStances,
  features: validFeatureList,
  leap: validLeap,
  revise: validRevision,
  design: designWithStances,
  split: breakdownWithStances,
};

const moreFirstPrinciples = { first_principles: validLeap.first_principles.slice(0, 2) };
const moreConstraintFlips = { constraint_flips: validLeap.constraint_flips.slice(0, 2) };
export const MORE_LEAP_FIXTURES = {
  first_principles: moreFirstPrinciples,
  analogies: validMoreItems,
  constraint_flips: moreConstraintFlips,
} as const;

export const FOLLOW_UPS_FIXTURE = {
  follow_ups: [{ field: 'metric', question: '怎么证明少浪费了？', why: '决定成功指标', options: ['扔掉的食材减半', '每周少点两次外卖'] }],
};

/** Every structured task output schema with fixtures it must accept (FREE_ASK answers plain text). */
export const SCHEMA_FIXTURES: ReadonlyArray<{ task: AiTask; name: string; schema: z.ZodType; fixtures: unknown[] }> = [
  { task: 'BRIEF_CLARIFY', name: 'ClarifyResult', schema: ClarifyResultSchema, fixtures: [validClarifyAsk, validClarifyProceed] },
  { task: 'BRIEF_EXTRACT', name: 'BriefExtraction', schema: BriefExtractionSchema, fixtures: [validBrief, briefWithInferredRedLines] },
  { task: 'BRIEF_PROBE', name: 'ProbeResult', schema: ProbeResultSchema, fixtures: [validProbeQuestion, validProbeDone] },
  { task: 'USERS_JTBD', name: 'UsersAnalysis', schema: UsersAnalysisSchema, fixtures: [validUsers] },
  { task: 'USERS_JTBD', name: 'JobsRefinement', schema: JobsRefinementSchema, fixtures: [validJobsRefinement] },
  { task: 'USERS_JTBD', name: 'PersonaBatch', schema: PersonaBatchSchema, fixtures: [validPersonaBatch] },
  { task: 'STAKE_MATRIX', name: 'StakeholdersAnalysis', schema: StakeholdersAnalysisSchema, fixtures: [validStakeholders] },
  { task: 'ALT_SCAN', name: 'AlternativesAnalysis', schema: AlternativesAnalysisSchema, fixtures: [validAlternatives, alternativesWithStance] },
  { task: 'SCEN_FEED', name: 'DimensionsResult', schema: DimensionsResultSchema, fixtures: [validDimensions] },
  { task: 'SCEN_FEED', name: 'ScenarioDrafts', schema: ScenarioDraftsSchema, fixtures: [validScenarioDrafts] },
  { task: 'SCEN_PAIN', name: 'ScenarioDeepAnalysis', schema: ScenarioDeepAnalysisSchema, fixtures: [validDeepAnalysis, deepAnalysisWithStances] },
  { task: 'FEAT_DRAFT', name: 'FeatureList', schema: FeatureListSchema, fixtures: [validFeatureList] },
  { task: 'FEAT_DRAFT', name: 'FeatureRevision', schema: FeatureRevisionSchema, fixtures: [validRevision] },
  { task: 'LEAP_FIRST_PRINCIPLES', name: 'CreativeLeapAnalysis', schema: CreativeLeapAnalysisSchema, fixtures: [validLeap] },
  { task: 'LEAP_FIRST_PRINCIPLES', name: 'MoreItems.first_principles', schema: MORE_ITEMS_SCHEMAS.first_principles, fixtures: [moreFirstPrinciples] },
  { task: 'LEAP_ANALOGY', name: 'MoreItems.analogies', schema: MORE_ITEMS_SCHEMAS.analogies, fixtures: [validMoreItems] },
  { task: 'LEAP_CONSTRAINT_FLIP', name: 'MoreItems.constraint_flips', schema: MORE_ITEMS_SCHEMAS.constraint_flips, fixtures: [moreConstraintFlips] },
  { task: 'DESIGN_PROPOSAL', name: 'DesignProposal', schema: DesignProposalSchema, fixtures: [validDesign, designWithStances] },
  { task: 'SPLIT_SUBFEATURES', name: 'SubfeatureBreakdown', schema: SubfeatureBreakdownSchema, fixtures: [validBreakdown, breakdownWithStances] },
  { task: 'CONSISTENCY_CHECK', name: 'ConsistencyCheck', schema: ConsistencyCheckSchema, fixtures: [validConsistencyCheck, emptyConsistencyCheck] },
  { task: 'FOLLOW_UPS', name: 'DeriveFollowUpsResult', schema: DeriveFollowUpsResultSchema, fixtures: [FOLLOW_UPS_FIXTURE] },
];
