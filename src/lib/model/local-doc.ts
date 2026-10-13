import type { z } from 'zod';
import { asItem, parseBody, type Item } from './item-types';
import { RepositoryError } from './repository';
import {
  DecisionEventSchema,
  ItemEnvelopeSchema,
  LinkSchema,
  RunSchema,
  type DecisionEvent,
  type Link,
  type Run,
} from './types';

// The single localStorage value that holds one project (`td:v2:<projectId>`).
// Decoding validates every record; invalid ones are dropped instead of
// crashing the app, and the report lets the caller keep a backup.

export const LOCAL_DOC_VERSION = 1;

export interface ProjectDoc {
  v: typeof LOCAL_DOC_VERSION;
  items: Item[];
  links: Link[];
  runs: Run[];
  events: DecisionEvent[];
}

export interface DecodeReport {
  /** The stored value could not be used at all (unparseable or wrong shape). */
  reset: boolean;
  droppedItems: number;
  droppedLinks: number;
  droppedRuns: number;
  droppedEvents: number;
}

export const emptyDoc = (): ProjectDoc => ({ v: LOCAL_DOC_VERSION, items: [], links: [], runs: [], events: [] });

const cleanReport = (): DecodeReport => ({ reset: false, droppedItems: 0, droppedLinks: 0, droppedRuns: 0, droppedEvents: 0 });

export function hasLoss(r: DecodeReport): boolean {
  return r.reset || r.droppedItems + r.droppedLinks + r.droppedRuns + r.droppedEvents > 0;
}

function decodeItem(raw: unknown, projectId: string): Item | null {
  const env = ItemEnvelopeSchema.safeParse(raw);
  if (!env.success || env.data.projectId !== projectId) return null;
  const body = parseBody(env.data.type, env.data.body);
  return body.ok ? asItem({ ...env.data, body: body.body }) : null;
}

/** Keeps records that pass `decode`, belong to the project and have a unique id. */
function keepValid<T extends { id: string }>(raw: unknown, decode: (r: unknown) => T | null): { kept: T[]; dropped: number } {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const r of list) {
    const v = decode(r);
    if (!v || seen.has(v.id)) continue;
    seen.add(v.id);
    kept.push(v);
  }
  return { kept, dropped: list.length - kept.length };
}

function schemaDecoder<T extends { projectId: string }>(schema: z.ZodType<T>, projectId: string) {
  return (r: unknown): T | null => {
    const p = schema.safeParse(r);
    return p.success && p.data.projectId === projectId ? p.data : null;
  };
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function decodeDoc(raw: string | null, projectId: string): { doc: ProjectDoc; report: DecodeReport } {
  const report = cleanReport();
  if (raw === null) return { doc: emptyDoc(), report };
  const parsed = parseJson(raw);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { doc: emptyDoc(), report: { ...report, reset: true } };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.v === 'number' && obj.v > LOCAL_DOC_VERSION) {
    // Written by a newer build: refuse rather than overwrite data we cannot read.
    throw new RepositoryError('storage', `project ${projectId} uses storage format v${obj.v}`);
  }
  if (obj.v !== LOCAL_DOC_VERSION) return { doc: emptyDoc(), report: { ...report, reset: true } };

  const items = keepValid(obj.items, (r) => decodeItem(r, projectId));
  const ids = new Set(items.kept.map((i) => i.id));
  const links = keepValid(obj.links, (r) => {
    const l = schemaDecoder(LinkSchema, projectId)(r);
    return l && ids.has(l.from) && ids.has(l.to) ? l : null;
  });
  const runs = keepValid(obj.runs, schemaDecoder(RunSchema, projectId));
  const events = keepValid(obj.events, schemaDecoder(DecisionEventSchema, projectId));
  return {
    doc: { v: LOCAL_DOC_VERSION, items: items.kept, links: links.kept, runs: runs.kept, events: events.kept },
    report: {
      reset: false,
      droppedItems: items.dropped,
      droppedLinks: links.dropped,
      droppedRuns: runs.dropped,
      droppedEvents: events.dropped,
    },
  };
}
