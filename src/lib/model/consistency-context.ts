import { NODES, type NodeKind } from '../../data/nodes';
import { MAX_CONSISTENCY_ITEMS, type ConsistencyItem } from '../ai/schemas/consistency-check';
import { contextItems, liveOf } from './context';
import { typeAllowedOn, type Item } from './item-types';
import type { ItemType, Link } from './types';

// What the AI consistency check reads: the decisions that travel downstream — per (node, type)
// the accepted items, or every non-rejected one while nothing is accepted (contextItems) — as
// compact one-line digests under their permanent ids, plus the Links between them. Rejected
// items never go in. The feat node's feature list is left out once the design has its own
// (revised) list on `final`.

/** Content types the check reads (run prose, critiques, process cells and findings stay out). */
export const CONSISTENCY_TYPES: readonly ItemType[] = [
  'brief', 'red_line', 'assumption', 'persona', 'job', 'stakeholder', 'engagement_plan',
  'alternative', 'diff_hypothesis', 'scenario', 'pain_point', 'insight', 'extreme', 'hostile',
  'pillar', 'feature', 'not_doing', 'first_principle', 'analogy', 'constraint_flip',
  'design_section', 'module', 'subtask',
];

/** Body keys that add tokens but no meaning for a contradiction check. */
const SKIP_KEYS = new Set([
  'raw_text', 'answers', 'follow_up_answers', 'follow_ups', 'highlights', 'completeness', 'rice', 'rice_score',
  'reach', 'impact', 'sources', 'critical', 'group', 'kind', 'dim', 'quote',
]);
const TEXT_MAX = 400;

function leaves(value: unknown, key: string, out: string[]): void {
  if (SKIP_KEYS.has(key) || value === null || value === undefined || value === '' || value === false) return;
  if (typeof value === 'string' || typeof value === 'number' || value === true) {
    out.push(key ? `${key}=${String(value)}` : String(value));
  } else if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string')) {
      if (value.length > 0) out.push(`${key}=${value.join(' / ')}`);
    } else value.forEach((v) => leaves(v, key, out));
  } else if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) leaves(v, k, out);
  }
}

/** The body as one clipped line of `key=value` pairs. */
export function digestText(item: Item): string {
  const parts: string[] = [];
  leaves(item.body, '', parts);
  const text = parts.join('；').replace(/\s+/g, ' ').trim();
  return text.length > TEXT_MAX ? `${text.slice(0, TEXT_MAX - 1)}…` : text;
}

function hasFinalList(items: readonly Item[], type: ItemType): boolean {
  return liveOf(items, 'final', type).length > 0;
}

function selected(items: readonly Item[]): Item[] {
  const out: Item[] = [];
  for (const { kind } of NODES) {
    for (const type of CONSISTENCY_TYPES) {
      if (!typeAllowedOn(type, kind)) continue;
      if (kind === 'feat' && ['feature', 'pillar', 'not_doing'].includes(type) && hasFinalList(items, type)) continue;
      out.push(...contextItems(items, kind, type));
    }
  }
  const accepted = out.filter((i) => i.decision === 'accepted');
  return out.length <= MAX_CONSISTENCY_ITEMS
    ? out
    : [...accepted, ...out.filter((i) => i.decision !== 'accepted')].slice(0, MAX_CONSISTENCY_ITEMS);
}

export interface ConsistencyInput {
  items: ConsistencyItem[];
  /** The items the digests were built from (Run.inputs). */
  sources: Item[];
  /** Node of every digested item (the adapter places each finding on the most downstream one). */
  nodeOf: Map<string, NodeKind>;
}

export function consistencyInput(all: readonly Item[], links: readonly Link[]): ConsistencyInput {
  const sources = selected(all);
  const ids = new Set(sources.map((i) => i.id));
  const items = sources.map((i): ConsistencyItem => ({
    id: i.id, type: i.type, node: i.node,
    decision: i.decision === 'accepted' ? 'accepted' : 'pending',
    text: digestText(i),
    links: links.filter((l) => l.from === i.id && ids.has(l.to)).slice(0, 40).map((l) => `${l.rel}:${l.to}`),
  }));
  return { items, sources, nodeOf: new Map(sources.map((i) => [i.id, i.node])) };
}
