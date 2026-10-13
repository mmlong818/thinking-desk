import { asItem, parseBody, type Item } from '../model/item-types';
import {
  DecisionEventSchema,
  ItemEnvelopeSchema,
  LinkSchema,
  RunSchema,
  type DecisionEvent,
  type Link,
  type Run,
} from '../model/types';

// Row <-> model mapping for the items / links / runs / decision_events tables.
// Reads are validated with the same Zod schemas as LocalRepository; rows that
// fail validation are skipped (and counted) rather than crashing a request.

type Timestamp = Date | string;

export interface ItemRow {
  project_id: string;
  id: string;
  node: string;
  type: string;
  body: unknown;
  origin: string;
  decision: string;
  decision_note: string | null;
  ai_stance: unknown;
  evidence: unknown;
  version: number;
  run_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
  deleted_at: Timestamp | null;
}

export interface LinkRow {
  project_id: string;
  id: string;
  from_id: string;
  to_id: string;
  rel: string;
  to_version_seen: number;
}

export interface RunRow {
  project_id: string;
  id: string;
  task: string;
  node: string;
  provider: string;
  model: string;
  prompt_version: string;
  inputs: unknown;
  status: string;
  error: string | null;
  usage: unknown;
  latency_ms: number;
  created_at: Timestamp;
}

export interface EventRow {
  project_id: string;
  id: string;
  item_id: string;
  kind: string;
  from_version: number;
  to_version: number;
  note: string | null;
  prev_body: unknown;
  link: unknown;
  actor: string;
  at: Timestamp;
}

const iso = (v: Timestamp): string => (v instanceof Date ? v : new Date(v)).toISOString();

/** Drops null / undefined values so optional model fields stay absent. */
export function compact<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== null && v !== undefined)) as Partial<T>;
}

export function rowToItem(row: ItemRow): Item | null {
  const env = ItemEnvelopeSchema.safeParse(compact({
    id: row.id, projectId: row.project_id, node: row.node, type: row.type, body: row.body,
    origin: row.origin, decision: row.decision, decisionNote: row.decision_note,
    aiStance: row.ai_stance, evidence: row.evidence, version: row.version, runId: row.run_id,
    createdAt: iso(row.created_at), updatedAt: iso(row.updated_at),
    deletedAt: row.deleted_at === null ? null : iso(row.deleted_at),
  }));
  if (!env.success) return null;
  const body = parseBody(env.data.type, env.data.body);
  return body.ok ? asItem({ ...env.data, body: body.body }) : null;
}

export function rowToLink(row: LinkRow): Link | null {
  const r = LinkSchema.safeParse({
    id: row.id, projectId: row.project_id, from: row.from_id, to: row.to_id, rel: row.rel,
    toVersionSeen: row.to_version_seen,
  });
  return r.success ? r.data : null;
}

export function rowToRun(row: RunRow): Run | null {
  const r = RunSchema.safeParse(compact({
    id: row.id, projectId: row.project_id, task: row.task, node: row.node, provider: row.provider,
    model: row.model, promptVersion: row.prompt_version, inputs: row.inputs, status: row.status,
    error: row.error, usage: row.usage, latencyMs: row.latency_ms, createdAt: iso(row.created_at),
  }));
  return r.success ? r.data : null;
}

export function rowToEvent(row: EventRow): DecisionEvent | null {
  const r = DecisionEventSchema.safeParse(compact({
    id: row.id, projectId: row.project_id, itemId: row.item_id, kind: row.kind,
    fromVersion: row.from_version, toVersion: row.to_version, note: row.note, prevBody: row.prev_body,
    link: row.link, actor: row.actor, at: iso(row.at),
  }));
  return r.success ? r.data : null;
}

/** JSON record for the bulk item statements (snake_case; absent optionals → SQL NULL). */
export function itemToJson(i: Item): Record<string, unknown> {
  return compact({
    id: i.id, node: i.node, type: i.type, body: i.body, origin: i.origin, decision: i.decision,
    decision_note: i.decisionNote, ai_stance: i.aiStance, evidence: i.evidence, version: i.version,
    run_id: i.runId, created_at: i.createdAt, updated_at: i.updatedAt, deleted_at: i.deletedAt,
  });
}

/** Maps rows, skipping invalid ones; `onInvalid` receives the count of skipped rows. */
export function mapRows<R, T>(rows: readonly R[], map: (r: R) => T | null, onInvalid?: (n: number) => void): T[] {
  const out = rows.map(map).filter((x): x is T => x !== null);
  if (out.length < rows.length) onInvalid?.(rows.length - out.length);
  return out;
}
