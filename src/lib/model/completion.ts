import { NODES, getNode, type CompletionClause, type NodeKind } from '../../data/nodes';
import type { Item } from './item-types';

// Node completion is derived from items via the `completion` rules in
// src/data/nodes.ts. The td-done cookie is only a cache of this value.

function clauseHolds(clause: CompletionClause, nodeItems: readonly Item[]): boolean {
  const n = nodeItems.filter((i) => clause.anyOf.includes(i.type)).length;
  return n >= clause.min;
}

function acceptedOn(kind: NodeKind, items: readonly Item[]): Item[] {
  return items.filter((i) => i.node === kind && i.decision === 'accepted' && !i.deletedAt);
}

export function isNodeComplete(kind: NodeKind, items: readonly Item[]): boolean {
  const def = getNode(kind);
  if (!def || def.completion.length === 0) return false;
  const nodeItems = acceptedOn(kind, items);
  return def.completion.every((c) => clauseHolds(c, nodeItems));
}

export function completedNodes(items: readonly Item[]): Set<NodeKind> {
  return new Set(NODES.filter((n) => isNodeComplete(n.kind, items)).map((n) => n.kind));
}

/** Value for the `td-done:<slug>` cookie: completed kinds in NODES order, comma-separated. */
export function completionCookieValue(completed: ReadonlySet<NodeKind>): string {
  return NODES.filter((n) => completed.has(n.kind)).map((n) => n.kind).join(',');
}
