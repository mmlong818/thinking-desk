import { z } from 'zod';
import type { NodeKind } from '../../data/nodes';
import { BriefExtractionSchema } from '../ai/tasks/extract-brief';
import { JobSchema, PersonaSchema, UsersAnalysisSchema } from '../ai/tasks/analyze-users';
import { EngagementPlanSchema, StakeholderSchema } from '../ai/tasks/analyze-stakeholders';
import {
  AlternativeSchema,
  FeatureBreakdownSchema,
  StrategicProfileSchema,
} from '../ai/tasks/analyze-alternatives';
import {
  DIMENSION_KEYS,
  DelightPointSchema,
  DesignInsightSchema,
  ElementSchema,
  ExtremeScenarioSchema,
  HostileScenarioSchema,
  MatrixCellSchema,
  PainPointSchema,
  ScenarioDraftSchema,
} from '../ai/tasks/analyze-scenarios';
import { FeatureSchema, NotDoingSchema, PillarSchema } from '../ai/tasks/draft-features';
import { RevisionNoteSchema } from '../ai/tasks/revise-features';
import {
  AnalogyTransferSchema,
  ConstraintFlipSchema,
  FirstPrincipleRethinkSchema,
} from '../ai/tasks/creative-leap';
import {
  DataEntitySchema,
  MilestoneSchema,
  ModuleSchema,
  SectionSchema,
  UserFlowSchema,
} from '../ai/tasks/generate-design';
import { SubFeatureSchema } from '../ai/tasks/split-subfeatures';
import type { ItemEnvelope, ItemRecord, ItemType, LinkRel } from './types';

// Per-type body registry. Bodies are derived from the task response schemas:
// `id` and cross-reference fields are omitted (the envelope id and Links
// replace them) and Zod strips them on parse.

/** A cross-reference field in raw AI output that becomes a Link from the item. */
export interface RefDecl {
  readonly path: readonly string[];
  readonly rel: LinkRel;
  readonly to: readonly ItemType[];
  /** Only resolve to items on this node (used where ids collide across nodes). */
  readonly node?: NodeKind;
}

export interface ItemTypeDef<B extends z.ZodType = z.ZodType> {
  readonly prefix: string;
  /** Nodes an item of this type may live on; 'any' for cross-node types. */
  readonly nodes: readonly NodeKind[] | 'any';
  /** 'one' = at most one live item per (project, node, type); AI runs update it in place. */
  readonly cardinality: 'one' | 'many';
  readonly body: B;
  readonly refs: readonly RefDecl[];
}

function def<B extends z.ZodType>(d: ItemTypeDef<B>): ItemTypeDef<B> {
  return d;
}

function ref(path: string, rel: LinkRel, to: ItemType | ItemType[], node?: NodeKind): RefDecl {
  return { path: path.split('.'), rel, to: Array.isArray(to) ? to : [to], node };
}

const CritiqueBody = UsersAnalysisSchema.shape.critiques.element;

const BriefBody = z.object({
  raw_text: z.string(),
  fields: BriefExtractionSchema.shape.fields.omit({ red_lines: true }),
  /** fact / missing only — assumption highlights become `assumption` items. */
  highlights: z
    .array(BriefExtractionSchema.shape.highlights.element.extend({ kind: z.enum(['fact', 'missing']) }))
    .default([]),
  follow_ups: BriefExtractionSchema.shape.follow_ups.default([]),
  completeness: BriefExtractionSchema.shape.completeness.default(0),
  answers: z
    .array(z.object({ question: z.string(), answer: z.union([z.string(), z.array(z.string())]) }))
    .default([]),
  follow_up_answers: z.record(z.string(), z.string()).default({}),
});

const AssumptionBody = z.object({
  statement: z.string().min(1),
  /** Verbatim span of the source text, when the assumption was spotted in it. */
  quote: z.string().optional(),
  rationale: z.string().optional(),
  signal: z.string().optional(),
  threshold: z.string().optional(),
  status: z.enum(['untested', 'validated', 'refuted', 'evolved']).default('untested'),
});

const LeapExtra = { required_changes: z.array(z.string()).optional() };

const TitledText = SectionSchema.omit({ id: true });
const DesignSectionBody = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('overview'), title: z.string(), one_liner: z.string(), vision: z.string() }),
  z.object({ kind: z.literal('principles'), items: z.array(z.string()) }),
  TitledText.extend({ kind: z.literal('ia') }),
  UserFlowSchema.omit({ id: true }).extend({ kind: z.literal('flow') }),
  TitledText.extend({ kind: z.literal('interaction') }),
  DataEntitySchema.extend({ kind: z.literal('data_entity') }),
  TitledText.extend({ kind: z.literal('tech') }),
  z.object({ kind: z.literal('metric'), name: z.string(), definition: z.string(), target: z.string() }),
  z.object({ kind: z.literal('risk'), risk: z.string(), mitigation: z.string() }),
  MilestoneSchema.extend({ kind: z.literal('milestone') }),
  z.object({ kind: z.literal('open_question'), text: z.string() }),
]);

const SummaryBody = z.object({
  topic: z.enum(['priority', 'differentiation_echo', 'leap_timing', 'revision', 'split']),
  text: z.string(),
  verdict: z.enum(['bold', 'selective', 'minimal']).optional(),
});

const FEATURE_NODES: readonly NodeKind[] = ['feat', 'final'];

export const ITEM_TYPE_DEFS = {
  brief: def({ prefix: 'brf', nodes: ['brief'], cardinality: 'one', body: BriefBody, refs: [] }),
  assumption: def({ prefix: 'asm', nodes: 'any', cardinality: 'many', body: AssumptionBody, refs: [] }),
  red_line: def({
    prefix: 'red', nodes: ['brief'], cardinality: 'many',
    body: z.object({ text: z.string().min(1) }), refs: [],
  }),
  persona: def({
    prefix: 'per', nodes: ['users'], cardinality: 'many', body: PersonaSchema.omit({ id: true }), refs: [],
  }),
  job: def({
    prefix: 'job', nodes: ['users'], cardinality: 'many',
    body: JobSchema.omit({ id: true, persona_ids: true, suggested_priority: true })
      .extend({ dimension: z.enum(['functional', 'emotional', 'social']) }),
    refs: [ref('persona_ids', 'derived_from', 'persona')],
  }),
  stakeholder: def({
    prefix: 'stk', nodes: ['stake'], cardinality: 'many', body: StakeholderSchema.omit({ id: true }), refs: [],
  }),
  engagement_plan: def({ prefix: 'eng', nodes: ['stake'], cardinality: 'one', body: EngagementPlanSchema, refs: [] }),
  alternative: def({
    prefix: 'alt', nodes: ['alt'], cardinality: 'many', body: AlternativeSchema.omit({ id: true }), refs: [],
  }),
  alt_profile: def({
    prefix: 'apf', nodes: ['alt'], cardinality: 'many', body: StrategicProfileSchema.omit({ alt_id: true }),
    refs: [ref('alt_id', 'derived_from', 'alternative')],
  }),
  alt_breakdown: def({
    prefix: 'abd', nodes: ['alt'], cardinality: 'many', body: FeatureBreakdownSchema.omit({ alt_id: true }),
    refs: [ref('alt_id', 'derived_from', 'alternative')],
  }),
  diff_hypothesis: def({
    prefix: 'dif', nodes: ['alt'], cardinality: 'one',
    body: z.object({ statement: z.string().min(1), key_threats: z.array(z.string()).default([]) }), refs: [],
  }),
  scenario_element: def({
    prefix: 'sel', nodes: ['scen'], cardinality: 'many',
    body: ElementSchema.omit({ id: true }).extend({ dim: z.enum(DIMENSION_KEYS) }), refs: [],
  }),
  scenario: def({
    prefix: 'scn', nodes: ['scen'], cardinality: 'many',
    body: ScenarioDraftSchema.omit({ id: true, element_ids: true, job_ids: true }),
    refs: [ref('element_ids', 'derived_from', 'scenario_element'), ref('job_ids', 'serves', 'job')],
  }),
  matrix_cell: def({
    prefix: 'mtx', nodes: ['scen'], cardinality: 'many',
    body: MatrixCellSchema.omit({ scenario_id: true, job_id: true }),
    refs: [ref('scenario_id', 'derived_from', 'scenario'), ref('job_id', 'derived_from', 'job')],
  }),
  extreme: def({
    prefix: 'ext', nodes: ['scen'], cardinality: 'many', body: ExtremeScenarioSchema.omit({ id: true }), refs: [],
  }),
  hostile: def({
    prefix: 'hst', nodes: ['scen'], cardinality: 'many', body: HostileScenarioSchema.omit({ id: true }), refs: [],
  }),
  pain_point: def({
    prefix: 'pan', nodes: ['scen'], cardinality: 'many', body: PainPointSchema.omit({ id: true, scenario_id: true }),
    refs: [ref('scenario_id', 'derived_from', 'scenario')],
  }),
  delight_point: def({
    prefix: 'dlt', nodes: ['scen'], cardinality: 'many',
    body: DelightPointSchema.omit({ id: true, scenario_id: true }),
    refs: [ref('scenario_id', 'derived_from', 'scenario')],
  }),
  insight: def({
    prefix: 'ins', nodes: ['scen'], cardinality: 'many',
    body: DesignInsightSchema.omit({ id: true, scenario_id: true, job_id: true, pain_id: true }),
    refs: [
      ref('scenario_id', 'derived_from', 'scenario'),
      ref('job_id', 'serves', 'job'),
      ref('pain_id', 'addresses', 'pain_point'),
    ],
  }),
  pillar: def({
    prefix: 'pil', nodes: FEATURE_NODES, cardinality: 'many', body: PillarSchema.omit({ id: true }), refs: [],
  }),
  feature: def({
    prefix: 'ftr', nodes: FEATURE_NODES, cardinality: 'many',
    body: FeatureSchema.omit({ id: true, traces: true, suggested_priority: true }),
    refs: [
      ref('traces.insight_ids', 'derived_from', 'insight'),
      ref('traces.job_ids', 'serves', 'job'),
      ref('traces.persona_ids', 'serves', 'persona'),
      ref('traces.scenario_ids', 'derived_from', 'scenario'),
    ],
  }),
  not_doing: def({ prefix: 'nod', nodes: FEATURE_NODES, cardinality: 'many', body: NotDoingSchema, refs: [] }),
  first_principle: def({
    prefix: 'fpr', nodes: ['leap'], cardinality: 'many',
    body: FirstPrincipleRethinkSchema.omit({ id: true }).extend(LeapExtra), refs: [],
  }),
  analogy: def({
    prefix: 'ana', nodes: ['leap'], cardinality: 'many',
    body: AnalogyTransferSchema.omit({ id: true }).extend(LeapExtra), refs: [],
  }),
  constraint_flip: def({
    prefix: 'flp', nodes: ['leap'], cardinality: 'many',
    body: ConstraintFlipSchema.omit({ id: true }).extend(LeapExtra), refs: [],
  }),
  revision: def({
    prefix: 'rev', nodes: ['final'], cardinality: 'many',
    body: RevisionNoteSchema.omit({ feature_id: true, original_feature_id: true, source_leap_ids: true }),
    refs: [
      ref('feature_id', 'derived_from', 'feature', 'final'),
      ref('original_feature_id', 'derived_from', 'feature', 'feat'),
      ref('source_leap_ids', 'derived_from', ['first_principle', 'analogy', 'constraint_flip']),
    ],
  }),
  design_section: def({ prefix: 'dsn', nodes: ['final'], cardinality: 'many', body: DesignSectionBody, refs: [] }),
  module: def({
    prefix: 'mod', nodes: ['final'], cardinality: 'many',
    body: ModuleSchema.omit({ id: true, feature_ids: true, depends_on: true }),
    refs: [ref('feature_ids', 'implements', 'feature'), ref('depends_on', 'depends_on', 'module')],
  }),
  subtask: def({
    prefix: 'tsk', nodes: ['split'], cardinality: 'many',
    // acceptance_criteria relaxed from min(1): the split UI creates blank subtasks for humans to fill in.
    body: SubFeatureSchema.omit({ id: true, dependencies: true }).extend({
      acceptance_criteria: z.array(z.string()).default([]),
      feature_name: z.string().optional(),
      critical: z.boolean().default(false),
    }),
    refs: [
      ref('feature_id', 'implements', 'feature'),
      ref('module_id', 'derived_from', 'module'),
      ref('dependencies', 'depends_on', 'subtask'),
    ],
  }),
  summary: def({ prefix: 'sum', nodes: 'any', cardinality: 'many', body: SummaryBody, refs: [] }),
  critique: def({ prefix: 'crt', nodes: 'any', cardinality: 'many', body: CritiqueBody, refs: [] }),
} satisfies Record<ItemType, ItemTypeDef>;

export type ItemBody<T extends ItemType> = z.output<(typeof ITEM_TYPE_DEFS)[T]['body']>;
export type ItemOf<T extends ItemType> = ItemEnvelope & { type: T; body: ItemBody<T> };
/** Discriminated on `type`: narrowing `item.type` narrows `item.body`. */
export type Item = { [T in ItemType]: ItemOf<T> }[ItemType];

export function typeDef(type: ItemType): ItemTypeDef {
  return ITEM_TYPE_DEFS[type];
}

export function isSingletonType(type: ItemType): boolean {
  return typeDef(type).cardinality === 'one';
}

export function typeAllowedOn(type: ItemType, node: NodeKind): boolean {
  const nodes = typeDef(type).nodes;
  return nodes === 'any' || nodes.includes(node);
}

export type BodyParse = { ok: true; body: unknown } | { ok: false; issues: string[] };

export function parseBody(type: ItemType, raw: unknown): BodyParse {
  const r = typeDef(type).body.safeParse(raw);
  if (r.success) return { ok: true, body: r.data };
  return { ok: false, issues: r.error.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`) };
}

/** Only call with a record whose body passed parseBody for its type. */
export function asItem(record: ItemRecord): Item {
  return record as Item;
}

/** Reads a ref field from raw AI output; single ids and id arrays both become string[]. */
export function readRefValues(raw: unknown, path: readonly string[]): string[] {
  let cur: unknown = raw;
  for (const key of path) {
    if (typeof cur !== 'object' || cur === null) return [];
    cur = (cur as Record<string, unknown>)[key];
  }
  if (typeof cur === 'string') return cur ? [cur] : [];
  if (Array.isArray(cur)) return cur.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return [];
}
