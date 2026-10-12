import type { NodeKind } from '../../data/nodes';
import type { BriefContext } from '../ai/schemas/snapshots';
import type { ClarificationAnswer } from '../ai/schemas/extract-brief';
import type { Item } from './item-types';
import type { ItemRef, ItemType } from './types';

// Which upstream items a prompt receives. Once the person has accepted any item of a type on a
// node, only the accepted ones count; until then every item they have not rejected does (the AI's
// output stands until judged). Rejected items never travel downstream.

/** The item variant of one type, narrowed on `type` (so `body` is typed). */
export type ItemOfType<T extends ItemType> = Extract<Item, { type: T }>;

export function liveOf<T extends ItemType>(items: readonly Item[], node: NodeKind, type: T): ItemOfType<T>[] {
  return items.filter((i): i is ItemOfType<T> => i.type === type && i.node === node && !i.deletedAt);
}

export function contextItems<T extends ItemType>(items: readonly Item[], node: NodeKind, type: T): ItemOfType<T>[] {
  const live = liveOf(items, node, type);
  const accepted = live.filter((i) => i.decision === 'accepted');
  return accepted.length > 0 ? accepted : live.filter((i) => i.decision !== 'rejected');
}

/** True when the context for (node, type) comes from explicit acceptance rather than the unjudged default. */
export function contextIsJudged(items: readonly Item[], node: NodeKind, type: ItemType): boolean {
  return liveOf(items, node, type).some((i) => i.decision === 'accepted');
}

/** Run.inputs for the items a prompt was built from (deduplicated, in order). */
export function inputsOf(...groups: ReadonlyArray<readonly Item[]>): ItemRef[] {
  const seen = new Set<string>();
  const out: ItemRef[] = [];
  for (const item of groups.flat()) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    out.push({ itemId: item.id, version: item.version });
  }
  return out;
}

export interface BriefRequestContext {
  /** Snapshot in the shape the AI routes validate (`BriefSnapshotSchema`). */
  brief: BriefContext;
  rawText?: string;
  answers?: ClarificationAnswer[];
  /** The brief, red-line and assumption items the snapshot was built from. */
  items: Item[];
}

/**
 * Rebuilds the brief snapshot the AI routes expect from the brief singleton plus its red-line
 * and assumption items (which the data model keeps as separate items). Null without a usable brief.
 */
export function briefRequestContext(items: readonly Item[]): BriefRequestContext | null {
  const [brief] = liveOf(items, 'brief', 'brief').filter((b) => b.decision !== 'rejected');
  if (!brief) return null;
  const redLines = contextItems(items, 'brief', 'red_line');
  const assumptions = contextItems(items, 'brief', 'assumption');
  const b = brief.body;
  return {
    brief: {
      fields: { ...b.fields, red_lines: redLines.map((r) => r.body.text) },
      highlights: [
        ...b.highlights,
        ...assumptions.map((a) => ({
          text: a.body.quote ?? a.body.statement,
          kind: 'assumption' as const,
          ...(a.body.rationale ? { reason: a.body.rationale } : {}),
        })),
      ],
    },
    ...(b.raw_text ? { rawText: b.raw_text } : {}),
    ...(b.answers.length > 0 ? { answers: b.answers } : {}),
    items: [brief, ...redLines, ...assumptions],
  };
}
