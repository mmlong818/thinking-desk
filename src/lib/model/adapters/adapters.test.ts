import { describe, expect, it } from 'vitest';
import type { NodeKind } from '../../../data/nodes';
import { AlternativesAnalysisSchema } from '../../ai/schemas/analyze-alternatives';
import { ScenarioDeepAnalysisSchema, DimensionsResultSchema, ScenarioDraftsSchema } from '../../ai/schemas/analyze-scenarios';
import { StakeholdersAnalysisSchema } from '../../ai/schemas/analyze-stakeholders';
import { JobsRefinementSchema, PersonaBatchSchema, UsersAnalysisSchema } from '../../ai/schemas/analyze-users';
import { CreativeLeapAnalysisSchema, MoreItemsResultSchema } from '../../ai/schemas/creative-leap';
import { FeatureListSchema } from '../../ai/schemas/draft-features';
import { BriefExtractionSchema } from '../../ai/schemas/extract-brief';
import { DesignProposalSchema, type DesignProposal } from '../../ai/schemas/generate-design';
import { FeatureRevisionSchema } from '../../ai/schemas/revise-features';
import { SubfeatureBreakdownSchema } from '../../ai/schemas/split-subfeatures';
import { validAlternatives } from '../../ai/schemas/__fixtures__/alternatives';
import { validLeap, validMoreItems } from '../../ai/schemas/__fixtures__/creative-leap';
import { validFeature, validFeatureList, validPillars } from '../../ai/schemas/__fixtures__/draft-features';
import { validBrief } from '../../ai/schemas/__fixtures__/extract-brief';
import { validDesign } from '../../ai/schemas/__fixtures__/generate-design';
import { validRevision } from '../../ai/schemas/__fixtures__/revise-features';
import { validDeepAnalysis, validDimensions, validScenarioDrafts } from '../../ai/schemas/__fixtures__/scenarios';
import { validBreakdown } from '../../ai/schemas/__fixtures__/split-subfeatures';
import { validStakeholders } from '../../ai/schemas/__fixtures__/stakeholders';
import { validJobsRefinement, validPersonaBatch, validUsers } from '../../ai/schemas/__fixtures__/users';
import { jobBody, makeItem, PROJECT, runInput, seqIdSource, T1 } from '../__fixtures__/model';
import type { Item } from '../item-types';
import { planRunOutput, type RunPlan } from '../plan-run';
import type { AiTask } from '../../ai/types';
import { NO_STANCE_REASON, UNEXPLAINED_REASON, type AdaptedOutput } from './common';
import {
  adaptAlternatives, adaptDeepAnalysis, adaptDesignProposal, adaptDimensions, adaptExtractBrief,
  adaptFeatureList, adaptFeatureRevision, adaptJobsRefinement, adaptLeapAnalysis, adaptMoreLeapItems,
  adaptPersonaBatch, adaptScenarioDrafts, adaptStakeholders, adaptSubfeatureBreakdown, adaptUsersAnalysis,
} from './index';

// Every adapter is checked end to end through the pure planner: drafts must validate against
// the type registry, cross-refs must resolve to Links, and stances / scopes must be as documented.

function ingest(out: AdaptedOutput, node: NodeKind, task: AiTask, items: Item[] = []): RunPlan {
  return planRunOutput(
    { items, links: [] },
    { run: runInput({ node, task }), drafts: out.drafts, replace: out.replace },
    { projectId: PROJECT, now: T1, idSource: seqIdSource() },
  );
}

const blocking = (plan: RunPlan) => plan.issues.filter((i) => i.kind !== 'empty_scope');
const ofType = (plan: RunPlan, type: Item['type']) => plan.created.filter((i) => i.type === type);
const linksFrom = (plan: RunPlan, id: string) => plan.linksAdded.filter((l) => l.from === id);

describe('brief adapter', () => {
  const out = BriefExtractionSchema.parse({
    ...validBrief,
    highlights: [...validBrief.highlights, { text: '学生愿意每天用', kind: 'assumption', reason: '没有数据' }],
    fields: { ...validBrief.fields, red_lines: ['不收集生物信息'] },
  });

  it('creates the brief singleton, red lines and assumptions linked by assumes', () => {
    const plan = ingest(adaptExtractBrief(out, { rawText: '原文', answers: [{ question: 'Q', answer: 'A' }] }), 'brief', 'BRIEF_EXTRACT');
    expect(blocking(plan)).toEqual([]);
    const [brief] = ofType(plan, 'brief');
    expect(brief.body).toMatchObject({ raw_text: '原文', answers: [{ question: 'Q', answer: 'A' }], completeness: 40 });
    expect(brief.body).not.toHaveProperty('fields.red_lines');
    expect(brief.aiStance).toMatchObject({ verdict: 'caution' });
    expect(ofType(plan, 'red_line').map((r) => r.body)).toEqual([{ text: '不收集生物信息' }]);
    const [asm] = ofType(plan, 'assumption');
    expect(asm.body).toMatchObject({ statement: '学生愿意每天用', rationale: '没有数据', status: 'untested' });
    expect(linksFrom(plan, brief.id)).toEqual([expect.objectContaining({ to: asm.id, rel: 'assumes' })]);
  });

  it('recommends the brief once completeness reaches the threshold', () => {
    const plan = ingest(adaptExtractBrief({ ...out, completeness: 80 }, { rawText: 'r', answers: [] }), 'brief', 'BRIEF_EXTRACT');
    expect(ofType(plan, 'brief')[0].aiStance?.verdict).toBe('recommend');
  });
});

describe('users adapters', () => {
  it('maps personas and jobs, links jobs to personas, turns priority into recommend', () => {
    const data = UsersAnalysisSchema.parse({
      ...validUsers,
      personas: [...validUsers.personas, { ...validUsers.personas[0], id: 'p-2', role: 'candidate' }],
      jobs: { ...validUsers.jobs, functional: [{ ...validUsers.jobs.functional[0], persona_ids: ['p-1'], suggested_priority: true }] },
      critiques: [{ kind: 'ask', title: 't', body: 'b' }],
    });
    const plan = ingest(adaptUsersAnalysis(data), 'users', 'USERS_JTBD');
    expect(blocking(plan)).toEqual([]);
    const [persona] = ofType(plan, 'persona');
    expect(persona.aiStance).toMatchObject({ verdict: 'recommend', reason: expect.stringContaining('主用户') });
    const candidates = ofType(plan, 'persona').filter((p) => p.type === 'persona' && p.body.role === 'candidate');
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.every((p) => p.aiStance?.verdict === 'neutral')).toBe(true);
    const jobs = ofType(plan, 'job');
    expect(jobs.map((j) => j.type === 'job' && j.body.dimension)).toEqual(['functional', 'emotional']);
    expect(jobs[0].aiStance?.verdict).toBe('recommend');
    expect(jobs[1].aiStance).toBeUndefined();
    expect(linksFrom(plan, jobs[0].id)).toEqual([expect.objectContaining({ to: persona.id, rel: 'derived_from' })]);
    expect(ofType(plan, 'summary')).toHaveLength(1);
    expect(ofType(plan, 'critique')).toHaveLength(1);
  });

  it('refine keeps accepted echoed jobs, rewrites pending ones and links to existing personas', () => {
    const persona = makeItem({ id: 'per_a' });
    const accepted = makeItem({ id: 'job_a', type: 'job', body: jobBody('A'), decision: 'accepted' });
    const pending = makeItem({ id: 'job_b', type: 'job', body: jobBody('B') });
    const data = JobsRefinementSchema.parse({
      ...validJobsRefinement,
      jobs: {
        functional: [{ id: 'job_a', title: 'A2', reach: 5, impact: 2, source: 's', persona_ids: ['per_a'] }],
        emotional: [{ id: 'job_b', title: 'B2', reach: 5, impact: 2, source: 's', persona_ids: ['per_a'] }],
        social: [],
      },
    });
    const plan = ingest(adaptJobsRefinement(data), 'users', 'USERS_JTBD', [persona, accepted, pending]);
    expect(blocking(plan)).toEqual([]);
    expect(plan.updated.map((i) => i.id)).toEqual(['job_b']);
    expect(plan.created.filter((i) => i.type === 'job')).toEqual([]);
    expect(plan.linksAdded).toEqual([expect.objectContaining({ from: 'job_b', to: 'per_a' })]);
  });

  it('adds personas without retiring anything', () => {
    const existing = makeItem({ id: 'per_x' });
    const out = adaptPersonaBatch(PersonaBatchSchema.parse(validPersonaBatch));
    expect(out.replace).toEqual([]);
    const plan = ingest(out, 'users', 'USERS_JTBD', [existing]);
    expect(ofType(plan, 'persona')).toHaveLength(2);
    expect(plan.retired).toEqual([]);
  });
});

describe('stakeholder adapter', () => {
  it('recommends required and manage-quadrant stakeholders and writes the engagement plan singleton', () => {
    const data = StakeholdersAnalysisSchema.parse({
      ...validStakeholders,
      stakeholders: validStakeholders.stakeholders.map((s, i) => ({
        ...s, required: i === 0, interest: i === 1 ? 'high' : s.interest,
      })),
    });
    const plan = ingest(adaptStakeholders(data), 'stake', 'STAKE_MATRIX');
    expect(blocking(plan)).toEqual([]);
    const stances = ofType(plan, 'stakeholder').map((s) => s.aiStance?.reason);
    expect(stances.slice(0, 3)).toEqual(['基线角色 · 必选', '高权力 · 高关心 → 深度共创', undefined]);
    expect(ofType(plan, 'engagement_plan')).toHaveLength(1);
  });
});

describe('alternatives adapter', () => {
  it('links profiles to alternatives and writes the hypothesis singleton with the threats', () => {
    const data = AlternativesAnalysisSchema.parse(validAlternatives);
    const plan = ingest(adaptAlternatives(data), 'alt', 'ALT_SCAN');
    expect(blocking(plan)).toEqual([]);
    const alts = ofType(plan, 'alternative');
    const profiles = ofType(plan, 'alt_profile');
    expect(profiles).toHaveLength(2);
    expect(linksFrom(plan, profiles[0].id)).toEqual([expect.objectContaining({ to: alts[0].id, rel: 'derived_from' })]);
    expect(ofType(plan, 'diff_hypothesis')[0].body).toEqual({ statement: 'h', key_threats: ['t'] });
    expect(alts.every((a) => a.aiStance?.verdict === 'recommend')).toBe(true);
  });
});

describe('scenario adapters', () => {
  const element = (id: string) => makeItem({ id, node: 'scen', type: 'scenario_element', body: { text: 't', relevance: 'medium', dim: 'time' } });

  it('exhaust: one element per candidate with its dimension', () => {
    const data = DimensionsResultSchema.parse(validDimensions);
    const plan = ingest(adaptDimensions(data), 'scen', 'SCEN_FEED');
    expect(blocking(plan)).toEqual([]);
    expect(ofType(plan, 'scenario_element')).toHaveLength(42);
  });

  it('combine: scenarios link to the existing elements and jobs by permanent id', () => {
    const els = [element('sel_1'), element('sel_2'), element('sel_3')];
    const job = makeItem({ id: 'job_1', type: 'job', body: jobBody() });
    const data = ScenarioDraftsSchema.parse({
      scenarios: validScenarioDrafts.scenarios.map((s) => ({ ...s, element_ids: ['sel_1', 'sel_2', 'sel_3'], job_ids: ['job_1'] })),
    });
    const plan = ingest(adaptScenarioDrafts(data), 'scen', 'SCEN_FEED', [...els, job]);
    expect(blocking(plan)).toEqual([]);
    const [first] = ofType(plan, 'scenario');
    expect(linksFrom(plan, first.id).map((l) => [l.to, l.rel])).toEqual([
      ['sel_1', 'derived_from'], ['sel_2', 'derived_from'], ['sel_3', 'derived_from'], ['job_1', 'serves'],
    ]);
  });

  it('deep: insights link to their scenario and to pain points of the same output', () => {
    const scenario = makeItem({ id: 'scn_1', node: 'scen', type: 'scenario', body: { title: 't', meta: 'm', narrative: 'n', pain_hint: 'p' } });
    const data = ScenarioDeepAnalysisSchema.parse({
      ...validDeepAnalysis,
      pain_points: validDeepAnalysis.pain_points.map((p) => ({ ...p, scenario_id: 'scn_1' })),
      design_insights: validDeepAnalysis.design_insights.map((d) => ({ ...d, scenario_id: 'scn_1', pain_id: 'pp-1' })),
    });
    const plan = ingest(adaptDeepAnalysis(data), 'scen', 'SCEN_PAIN', [scenario]);
    expect(blocking(plan)).toEqual([]);
    const pain = ofType(plan, 'pain_point')[0];
    const [insight] = ofType(plan, 'insight');
    expect(linksFrom(plan, insight.id).map((l) => [l.to, l.rel])).toEqual([['scn_1', 'derived_from'], [pain.id, 'addresses']]);
    expect(ofType(plan, 'hostile').every((h) => h.aiStance?.verdict === 'recommend')).toBe(true);
  });
});

describe('feature adapters', () => {
  it('stores the pillar name, recommends priorities and flags red lines with caution', () => {
    const data = FeatureListSchema.parse({
      ...validFeatureList,
      features: validFeatureList.features.map((f, i) => ({
        ...f, suggested_priority: i === 0, red_line_risk: i === 1, ethics_concern: i === 1 ? '涉及未成年人数据' : '',
      })),
    });
    const plan = ingest(adaptFeatureList(data), 'feat', 'FEAT_DRAFT');
    expect(blocking(plan)).toEqual([]);
    const features = ofType(plan, 'feature');
    expect(features[0].body).toMatchObject({ pillar: 'Pillar 1' });
    expect(features[0].aiStance?.verdict).toBe('recommend');
    expect(features[1].aiStance).toEqual({ verdict: 'caution', reason: '涉及未成年人数据' });
    expect(ofType(plan, 'pillar')).toHaveLength(2);
    expect(ofType(plan, 'not_doing')).toHaveLength(1);
  });
});

describe('leap adapters', () => {
  it('applies top picks as recommend + required_changes and keeps the timing as a summary', () => {
    const plan = ingest(adaptLeapAnalysis(CreativeLeapAnalysisSchema.parse(validLeap)), 'leap', 'LEAP_FIRST_PRINCIPLES');
    expect(blocking(plan)).toEqual([]);
    const picked = ofType(plan, 'analogy')[0];
    expect(picked.aiStance).toEqual({ verdict: 'recommend', reason: 'w' });
    expect(picked.body).toMatchObject({ required_changes: ['c'] });
    expect(ofType(plan, 'summary')[0].body).toEqual({ topic: 'leap_timing', text: 'r', verdict: 'selective' });
    expect(ofType(plan, 'first_principle')).toHaveLength(4);
  });

  it('more items are additive', () => {
    const out = adaptMoreLeapItems(MoreItemsResultSchema.parse(validMoreItems));
    expect(out.replace).toEqual([]);
    expect(ingest(out, 'leap', 'LEAP_ANALOGY').created).toHaveLength(3);
  });
});

describe('final adapters', () => {
  const feat = (id: string) => makeItem({ id, node: 'feat', type: 'feature', body: { ...validFeature(1), pillar: 'Pillar 1' } });

  it('revision: features land on final with lineage to the feat originals; revisions link both sides', () => {
    const originals = [feat('ftr_1'), feat('ftr_2')];
    const data = FeatureRevisionSchema.parse({
      ...validRevision,
      revised_features: [{ ...validFeature(1), id: 'ftr_1' }, validFeature(2), validFeature(3)],
      revisions: [
        { action: 'kept', feature_id: 'ftr_1', reason: 'r' },
        { action: 'modified', feature_id: 'f-2', original_feature_id: 'ftr_2', reason: 'r' },
      ],
    });
    const plan = ingest(adaptFeatureRevision(data, { originalFeatureIds: ['ftr_1', 'ftr_2'] }), 'final', 'FEAT_DRAFT', originals);
    expect(blocking(plan)).toEqual([]);
    const finals = ofType(plan, 'feature');
    expect(finals.every((f) => f.node === 'final')).toBe(true);
    expect(linksFrom(plan, finals[0].id)).toContainEqual(expect.objectContaining({ to: 'ftr_1', rel: 'derived_from' }));
    expect(linksFrom(plan, finals[1].id)).toContainEqual(expect.objectContaining({ to: 'ftr_2', rel: 'derived_from' }));
    const modified = ofType(plan, 'revision')[1];
    expect(linksFrom(plan, modified.id).map((l) => l.to)).toEqual([finals[1].id, 'ftr_2']);
    expect(ofType(plan, 'summary').map((s) => s.type === 'summary' && s.body.topic)).toEqual(['revision', 'differentiation_echo']);
  });

  it('design: one section per part, modules implement the features they name', () => {
    const finalFeature = makeItem({ id: 'ftr_9', node: 'final', type: 'feature', body: { ...validFeature(1), pillar: 'Pillar 1' } });
    const data = DesignProposalSchema.parse({
      ...validDesign,
      modules: validDesign.modules.map((m) => ({ ...m, feature_ids: ['ftr_9'] })),
      metrics: [{ name: 'DAU', definition: 'd', target: 't' }],
      open_questions: ['q'],
    });
    const plan = ingest(adaptDesignProposal(data), 'final', 'DESIGN_PROPOSAL', [finalFeature]);
    expect(blocking(plan)).toEqual([]);
    const kinds = ofType(plan, 'design_section').map((s) => s.type === 'design_section' && s.body.kind);
    expect(kinds).toEqual(['overview', 'principles', 'ia', 'ia', 'flow', 'interaction', 'data_entity', 'tech', 'metric', 'milestone', 'open_question']);
    const [mod] = ofType(plan, 'module');
    expect(linksFrom(plan, mod.id)).toEqual([expect.objectContaining({ to: 'ftr_9', rel: 'implements' })]);
  });

  it("design: every part carries the model's own stance; a missing one is neutral, never recommend", () => {
    const data = DesignProposalSchema.parse({
      ...validDesign,
      overview_stance: { verdict: 'recommend', reason: '定位与 Brief 一致' },
      information_architecture: [
        { ...validDesign.information_architecture[0], stance: { verdict: 'caution', reason: '依赖未验证的假设' } },
        validDesign.information_architecture[1],
      ],
      modules: [{ ...validDesign.modules[0], stance: { verdict: 'recommend', reason: '职责清楚' } }, validDesign.modules[1]],
      open_questions: ['旧格式的字符串', { question: 'q2', stance: { verdict: 'caution', reason: ' ' } }],
    });
    const plan = ingest(adaptDesignProposal(data), 'final', 'DESIGN_PROPOSAL');
    expect(plan.issues.filter((i) => i.kind !== 'unresolved_ref')).toEqual([]);
    const stances = ofType(plan, 'design_section').map((s) => s.type === 'design_section' && [s.body.kind, s.aiStance]);
    expect(stances.slice(0, 4)).toEqual([
      ['overview', { verdict: 'recommend', reason: '定位与 Brief 一致' }],
      ['principles', { verdict: 'neutral', reason: NO_STANCE_REASON }],
      ['ia', { verdict: 'caution', reason: '依赖未验证的假设' }],
      ['ia', { verdict: 'neutral', reason: NO_STANCE_REASON }],
    ]);
    expect(stances.slice(-2)).toEqual([
      ['open_question', { verdict: 'neutral', reason: NO_STANCE_REASON }],
      ['open_question', { verdict: 'caution', reason: UNEXPLAINED_REASON }],
    ]);
    expect(ofType(plan, 'design_section').at(-2)?.body).toEqual({ kind: 'open_question', text: '旧格式的字符串' });
    expect(ofType(plan, 'module').map((m) => m.aiStance?.verdict)).toEqual(['recommend', 'neutral']);
    expect(plan.created.some((i) => 'stance' in (i.body as object))).toBe(false);
  });

  it('design: an output without any stance fields (pre-stance shape) adapts with neutral stances', () => {
    const legacy = { ...validDesign, open_questions: [] } as unknown as DesignProposal;
    const out = adaptDesignProposal(legacy);
    expect(out.drafts.every((d) => d.aiStance?.verdict === 'neutral')).toBe(true);
    expect(ingest(out, 'final', 'DESIGN_PROPOSAL').issues.filter((i) => i.kind === 'invalid_body')).toEqual([]);
  });
});

describe('split adapter', () => {
  it('subtasks implement their feature, depend on each other and carry the critical flag', () => {
    const feature = makeItem({ id: 'ftr_1', node: 'final', type: 'feature', body: { ...validFeature(1), pillar: 'p' } });
    const data = SubfeatureBreakdownSchema.parse({
      ...validBreakdown,
      splits: [{
        ...validBreakdown.splits[0],
        feature_id: 'ftr_1',
        subfeatures: [
          validBreakdown.splits[0].subfeatures[0],
          { ...validBreakdown.splits[0].subfeatures[0], id: 'sf-2', dependencies: ['sf-1'] },
        ],
      }],
      critical_path: ['sf-2'],
    });
    const plan = ingest(adaptSubfeatureBreakdown(data), 'split', 'SPLIT_SUBFEATURES', [feature]);
    expect(blocking(plan)).toEqual([]);
    const [a, b] = ofType(plan, 'subtask');
    expect(b.body).toMatchObject({ feature_name: 'F1', critical: true });
    expect(linksFrom(plan, b.id).map((l) => [l.to, l.rel])).toEqual([['ftr_1', 'implements'], [a.id, 'depends_on']]);
    expect(a.aiStance).toEqual({ verdict: 'neutral', reason: NO_STANCE_REASON });
    expect(b.aiStance).toEqual({ verdict: 'neutral', reason: NO_STANCE_REASON });
    expect('stance' in b.body).toBe(false);
  });

  it("subtasks take the model's per-item verdict, critical or not", () => {
    const sub = validBreakdown.splits[0].subfeatures[0];
    const data = SubfeatureBreakdownSchema.parse({
      ...validBreakdown,
      splits: [{
        ...validBreakdown.splits[0],
        subfeatures: [
          { ...sub, stance: { verdict: 'recommend', reason: '设计案已定，可直接开工' } },
          { ...sub, id: 'sf-2', stance: { verdict: 'caution', reason: '依赖未拍板的支付方案' } },
        ],
      }],
      critical_path: ['sf-2'],
    });
    const [a, b] = ofType(ingest(adaptSubfeatureBreakdown(data), 'split', 'SPLIT_SUBFEATURES'), 'subtask');
    expect(a.aiStance).toEqual({ verdict: 'recommend', reason: '设计案已定，可直接开工' });
    expect(b.aiStance).toEqual({ verdict: 'caution', reason: '依赖未拍板的支付方案' });
    expect(b.body).toMatchObject({ critical: true });
  });
});

it('fixtures keep their pillar ids pointing at real pillars (sanity)', () => {
  expect(validPillars.map((p) => p.id)).toContain(validFeature(1).pillar);
});
