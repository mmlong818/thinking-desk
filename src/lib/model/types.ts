import { z } from 'zod';
import { NODES, type NodeKind } from '../../data/nodes';
import type { AiTask } from '../ai/types';

// Envelope-level schemas shared by every repository implementation.
// Per-type item bodies live in ./item-types.ts. See docs/data-model.md.

const NODE_KIND_LIST = NODES.map((n) => n.kind) as [NodeKind, ...NodeKind[]];
export const NodeKindSchema = z.enum(NODE_KIND_LIST);

export const ITEM_TYPES = [
  'brief', 'assumption', 'red_line',
  'persona', 'job',
  'stakeholder', 'engagement_plan',
  'alternative', 'alt_profile', 'alt_breakdown', 'diff_hypothesis',
  'scenario_element', 'scenario', 'matrix_cell', 'extreme', 'hostile',
  'pain_point', 'delight_point', 'insight',
  'pillar', 'feature', 'not_doing',
  'first_principle', 'analogy', 'constraint_flip',
  'revision', 'design_section', 'module',
  'subtask',
  'summary', 'critique',
] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ItemTypeSchema = z.enum(ITEM_TYPES);

export const ORIGINS = ['ai', 'human', 'ai_edited'] as const;
export const DECISIONS = ['pending', 'accepted', 'rejected'] as const;
export const LINK_RELS = [
  'derived_from', 'serves', 'addresses', 'implements',
  'mitigates', 'conflicts_with', 'assumes', 'depends_on',
] as const;
export const RUN_STATUSES = ['ok', 'retried', 'failed'] as const;
export const EVENT_KINDS = ['created', 'accepted', 'rejected', 'reset', 'edited', 'deleted'] as const;
export const ACTORS = ['human', 'ai'] as const;

export type Origin = (typeof ORIGINS)[number];
export type Decision = (typeof DECISIONS)[number];
export type LinkRel = (typeof LINK_RELS)[number];
export type RunStatus = (typeof RUN_STATUSES)[number];
export type EventKind = (typeof EVENT_KINDS)[number];
export type Actor = (typeof ACTORS)[number];

const Id = z.string().min(1);
const Timestamp = z.iso.datetime({ offset: true });
const Version = z.number().int().min(1);

export const AiStanceSchema = z.object({
  verdict: z.enum(['recommend', 'neutral', 'caution']),
  reason: z.string(),
});
export type AiStance = z.infer<typeof AiStanceSchema>;

export const EvidenceSchema = z.object({
  basis: z.enum(['web', 'model_knowledge', 'user_input']),
  confidence: z.number().min(0).max(1),
  sources: z.array(z.object({ title: z.string(), url: z.string().optional(), verified: z.boolean() })),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

/** Item envelope. `body` is validated separately against the per-type registry. */
export const ItemEnvelopeSchema = z.object({
  id: Id,
  projectId: Id,
  node: NodeKindSchema,
  type: ItemTypeSchema,
  body: z.unknown(),
  origin: z.enum(ORIGINS),
  decision: z.enum(DECISIONS),
  decisionNote: z.string().optional(),
  aiStance: AiStanceSchema.optional(),
  evidence: EvidenceSchema.optional(),
  version: Version,
  runId: Id.optional(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
  deletedAt: Timestamp.optional(),
});
export type ItemEnvelope = Omit<z.infer<typeof ItemEnvelopeSchema>, 'type' | 'body'>;
/** Loosely typed item used inside the planner before the body is narrowed. */
export type ItemRecord = ItemEnvelope & { type: ItemType; body: unknown };

/** `from` depends on `to`. Stale when to.version > toVersionSeen (computed, never stored). */
export const LinkSchema = z.object({
  id: Id,
  projectId: Id,
  from: Id,
  to: Id,
  rel: z.enum(LINK_RELS),
  toVersionSeen: Version,
});
export type Link = z.infer<typeof LinkSchema>;

export const ItemRefSchema = z.object({ itemId: Id, version: Version });
export type ItemRef = z.infer<typeof ItemRefSchema>;

export const UsageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
});
export type Usage = z.infer<typeof UsageSchema>;

/**
 * Stored runs keep `task` as a plain string so that runs recorded under an
 * AiTask literal that was later pruned still load. New runs are typed AiTask
 * at the write boundary (RunInput).
 */
export const RunSchema = z.object({
  id: Id,
  projectId: Id,
  task: z.string().min(1),
  node: NodeKindSchema,
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  inputs: z.array(ItemRefSchema),
  status: z.enum(RUN_STATUSES),
  error: z.string().optional(),
  usage: UsageSchema.optional(),
  latencyMs: z.number().int().min(0),
  createdAt: Timestamp,
});
export type Run = z.infer<typeof RunSchema>;
export type RunInput = Omit<Run, 'id' | 'projectId' | 'createdAt' | 'task'> & { task: AiTask };

export const DecisionEventSchema = z.object({
  id: Id,
  projectId: Id,
  itemId: Id,
  kind: z.enum(EVENT_KINDS),
  fromVersion: z.number().int().min(0),
  toVersion: Version,
  note: z.string().optional(),
  actor: z.enum(ACTORS),
  at: Timestamp,
});
export type DecisionEvent = z.infer<typeof DecisionEventSchema>;
