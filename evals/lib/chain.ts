import { RunTaskError, type RunMeta, type RunTaskResult, type TaskOptions } from '../../src/lib/ai/run-task';
import type { AlternativesAnalysis } from '../../src/lib/ai/schemas/analyze-alternatives';
import {
  DIMENSION_KEYS, type DimensionsResult, type ScenarioDeepAnalysis, type ScenarioDrafts,
} from '../../src/lib/ai/schemas/analyze-scenarios';
import type { StakeholdersAnalysis } from '../../src/lib/ai/schemas/analyze-stakeholders';
import type { Job, UsersAnalysis } from '../../src/lib/ai/schemas/analyze-users';
import type { CreativeLeapAnalysis } from '../../src/lib/ai/schemas/creative-leap';
import type { Feature, FeatureList } from '../../src/lib/ai/schemas/draft-features';
import type { BriefExtraction } from '../../src/lib/ai/schemas/extract-brief';
import type { DesignProposal } from '../../src/lib/ai/schemas/generate-design';
import type { FeatureRevision } from '../../src/lib/ai/schemas/revise-features';
import type { BriefContext, DesignSnapshot, FeatureDigest } from '../../src/lib/ai/schemas/snapshots';
import type { SubfeatureBreakdown } from '../../src/lib/ai/schemas/split-subfeatures';
import { analyzeAlternatives } from '../../src/lib/ai/tasks/analyze-alternatives';
import { combineScenarios, deepAnalyzeScenarios, exhaustScenarioDimensions } from '../../src/lib/ai/tasks/analyze-scenarios';
import { analyzeStakeholders } from '../../src/lib/ai/tasks/analyze-stakeholders';
import { analyzeUsers } from '../../src/lib/ai/tasks/analyze-users';
import { analyzeCreativeLeap } from '../../src/lib/ai/tasks/creative-leap';
import { draftFeatures } from '../../src/lib/ai/tasks/draft-features';
import { extractBrief } from '../../src/lib/ai/tasks/extract-brief';
import { generateDesignProposal } from '../../src/lib/ai/tasks/generate-design';
import { reviseFeaturesWithLeaps } from '../../src/lib/ai/tasks/revise-features';
import { splitSubfeatures } from '../../src/lib/ai/tasks/split-subfeatures';
import type { AiTask } from '../../src/lib/ai/types';

// The brief → users → … → split chain for one golden brief, calling the task functions the
// routes call. Between steps the person's judgment is simulated as the AI-led default: accept
// what the AI recommends (priority jobs, high-relevance elements, priority features, top leap
// picks); where the AI recommends nothing, everything it produced. Scenarios carry no AI
// recommendation, so the first three are deepened.

export interface Outputs {
  brief: BriefExtraction;
  users: UsersAnalysis;
  stake: StakeholdersAnalysis;
  alt: AlternativesAnalysis;
  scen_exhaust: DimensionsResult;
  scen_combine: ScenarioDrafts;
  scen_deep: ScenarioDeepAnalysis;
  features: FeatureList;
  leap: CreativeLeapAnalysis;
  revise: FeatureRevision;
  design: DesignProposal;
  split: SubfeatureBreakdown;
}
export type StepName = keyof Outputs;

export const CHAIN_STEPS: readonly StepName[] = [
  'brief', 'users', 'stake', 'alt', 'scen_exhaust', 'scen_combine', 'scen_deep', 'features', 'leap', 'revise', 'design', 'split',
];

interface Ctx {
  rawText: string;
  out: Partial<Outputs>;
}

function need<K extends StepName>(ctx: Ctx, step: K): Outputs[K] {
  const value = ctx.out[step];
  if (value === undefined) throw new Error(`step ${step} has no output`);
  return value as Outputs[K];
}

// ---- the person's simulated judgments -------------------------------------------------------

export function lockedJobs(u: UsersAnalysis): Job[] {
  const all = [...u.jobs.functional, ...u.jobs.emotional, ...u.jobs.social];
  const priority = all.filter((j) => j.suggested_priority);
  return priority.length > 0 ? priority : all;
}

export function pickElements(d: DimensionsResult): string[] {
  const all = DIMENSION_KEYS.flatMap((k) => d.dimensions[k]);
  const high = all.filter((e) => e.relevance === 'high');
  const chosen = high.length >= 3 ? high : all.filter((e) => e.relevance !== 'low');
  return (chosen.length >= 3 ? chosen : all).map((e) => e.id);
}

const MAX_DEEP = 3;

function acceptedFeatures(features: readonly Feature[]): Feature[] {
  const recommended = features.filter((f) => f.suggested_priority && !f.red_line_risk);
  return recommended.length > 0 ? recommended : [...features];
}

const digest = (f: Feature): FeatureDigest => ({
  id: f.id, name: f.name, description: f.description, pillar: f.pillar, kano: f.kano,
  rice_score: f.rice_score, core_hypothesis: f.core_hypothesis, validation_metric: f.validation_metric,
});

export function designSnapshot(d: DesignProposal): DesignSnapshot {
  return {
    title: d.title, one_liner: d.one_liner,
    modules: d.modules.map((m) => ({ id: m.id, name: m.name, feature_ids: m.feature_ids })),
    user_flows: d.user_flows.map((f) => ({ name: f.name, goal: f.goal })),
    data_model: d.data_model.map((e) => ({ name: e.name })),
  };
}

// ---- request arguments shared by several steps ------------------------------------------------

function briefArgs(ctx: Ctx): { brief: BriefContext; rawText: string } {
  const b = need(ctx, 'brief');
  return { brief: { fields: b.fields, highlights: b.highlights }, rawText: ctx.rawText };
}

function people(ctx: Ctx) {
  const u = need(ctx, 'users');
  return { ...briefArgs(ctx), personas: u.personas, lockedJobs: lockedJobs(u) };
}

function pickedScenarios(ctx: Ctx) {
  return need(ctx, 'scen_combine').scenarios.slice(0, MAX_DEEP);
}

function featureContext(ctx: Ctx) {
  const deep = need(ctx, 'scen_deep');
  return {
    ...people(ctx),
    scenarios: pickedScenarios(ctx),
    design_insights: deep.design_insights.map(({ id, scenario_id, job_id, insight_text, action }) => ({
      id, scenario_id, insight_text, action, ...(job_id ? { job_id } : {}),
    })),
    pain_points: deep.pain_points.map(({ id, moment, root_cause }) => ({ id, moment, root_cause })),
    differentiation_hypothesis: ctx.out.alt?.differentiation_hypothesis,
  };
}

function leapContext(ctx: Ctx) {
  return {
    ...people(ctx),
    features: acceptedFeatures(need(ctx, 'features').features).map(digest),
    differentiation_hypothesis: ctx.out.alt?.differentiation_hypothesis,
    alt_threats: ctx.out.alt?.key_threats,
  };
}

function reviseArgs(ctx: Ctx) {
  const list = need(ctx, 'features');
  const leap = need(ctx, 'leap');
  const picks = leap.recommendation.top_picks.map((p) => p.source_id);
  const fallback = [leap.first_principles[0], leap.analogies[0], leap.constraint_flips[0]].flatMap((x) => (x ? [x.id] : []));
  return {
    ...briefArgs(ctx),
    original: { features: acceptedFeatures(list.features).map(digest), pillars: list.pillars, differentiation_echo: list.differentiation_echo },
    leaps: { first_principles: leap.first_principles, analogies: leap.analogies, constraint_flips: leap.constraint_flips },
    selectedLeapIds: picks.length > 0 ? picks : fallback,
  };
}

// ---- the steps -------------------------------------------------------------------------------

interface StepDef<K extends StepName> {
  task: AiTask;
  /** Steps whose output this one cannot run without. */
  needs: readonly StepName[];
  /** Steps whose output the prompt quotes (for the dry-run context allowance). */
  reads: readonly StepName[];
  run(ctx: Ctx, opts: TaskOptions): Promise<RunTaskResult<Outputs[K]>>;
}

const PEOPLE: readonly StepName[] = ['brief', 'users'];

export const STEPS: { [K in StepName]: StepDef<K> } = {
  brief: { task: 'BRIEF_EXTRACT', needs: [], reads: [], run: (c, o) => extractBrief({ rawText: c.rawText, answers: [] }, o) },
  users: { task: 'USERS_JTBD', needs: ['brief'], reads: ['brief'], run: (c, o) => analyzeUsers(briefArgs(c), o) },
  stake: { task: 'STAKE_MATRIX', needs: ['users'], reads: PEOPLE, run: (c, o) => analyzeStakeholders(people(c), o) },
  alt: { task: 'ALT_SCAN', needs: ['users'], reads: PEOPLE, run: (c, o) => analyzeAlternatives(people(c), o) },
  scen_exhaust: { task: 'SCEN_FEED', needs: ['users'], reads: PEOPLE, run: (c, o) => exhaustScenarioDimensions(people(c), o) },
  scen_combine: {
    task: 'SCEN_FEED', needs: ['scen_exhaust'], reads: [...PEOPLE, 'scen_exhaust'],
    run: (c, o) => {
      const dimensions = need(c, 'scen_exhaust');
      return combineScenarios({ ...people(c), dimensions, selectedElementIds: pickElements(dimensions) }, o);
    },
  },
  scen_deep: {
    task: 'SCEN_PAIN', needs: ['scen_combine'], reads: [...PEOPLE, 'scen_combine'],
    run: (c, o) => deepAnalyzeScenarios({
      ...people(c), scenarios: need(c, 'scen_combine').scenarios, pickedScenarioIds: pickedScenarios(c).map((s) => s.id),
    }, o),
  },
  features: {
    task: 'FEAT_DRAFT', needs: ['scen_deep'], reads: [...PEOPLE, 'scen_combine', 'scen_deep', 'alt'],
    run: (c, o) => draftFeatures(featureContext(c), o),
  },
  leap: { task: 'LEAP_FIRST_PRINCIPLES', needs: ['features'], reads: [...PEOPLE, 'features', 'alt'], run: (c, o) => analyzeCreativeLeap(leapContext(c), o) },
  revise: { task: 'FEAT_DRAFT', needs: ['leap'], reads: ['brief', 'features', 'leap'], run: (c, o) => reviseFeaturesWithLeaps(reviseArgs(c), o) },
  design: {
    task: 'DESIGN_PROPOSAL', needs: ['revise'], reads: ['brief', 'revise'],
    run: (c, o) => {
      const r = need(c, 'revise');
      return generateDesignProposal({ ...briefArgs(c), features: acceptedFeatures(r.revised_features).map(digest), pillars: r.revised_pillars }, o);
    },
  },
  split: { task: 'SPLIT_SUBFEATURES', needs: ['design'], reads: ['design'], run: (c, o) => splitSubfeatures({ design: designSnapshot(need(c, 'design')) }, o) },
};

// ---- running the chain -------------------------------------------------------------------------

export interface StepRecord {
  step: StepName;
  task: AiTask;
  status: 'ok' | 'retried' | 'failed' | 'skipped';
  run?: RunMeta;
  error?: string;
  data?: unknown;
}

async function runStep<K extends StepName>(step: K, ctx: Ctx, opts: TaskOptions): Promise<StepRecord> {
  const def: StepDef<K> = STEPS[step];
  if (!def.needs.every((n) => ctx.out[n] !== undefined)) return { step, task: def.task, status: 'skipped' };
  try {
    const res = await def.run(ctx, opts);
    ctx.out[step] = res.data;
    return { step, task: def.task, status: res.run.status === 'retried' ? 'retried' : 'ok', run: res.run, data: res.data };
  } catch (e) {
    if (e instanceof RunTaskError) return { step, task: def.task, status: 'failed', run: e.run, error: `${e.code}: ${e.message}` };
    return { step, task: def.task, status: 'failed', error: e instanceof Error ? e.message : String(e) };
  }
}

/** Runs every step in order; a step whose inputs failed is skipped. `optionsFor` picks model / deps per step. */
export async function runChain(
  rawText: string,
  optionsFor: (step: StepName) => TaskOptions,
  onStep?: (record: StepRecord) => void,
): Promise<StepRecord[]> {
  const ctx: Ctx = { rawText, out: {} };
  const records: StepRecord[] = [];
  for (const step of CHAIN_STEPS) {
    const record = await runStep(step, ctx, optionsFor(step));
    records.push(record);
    onStep?.(record);
  }
  return records;
}
