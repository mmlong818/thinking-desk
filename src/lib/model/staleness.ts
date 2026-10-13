import type { NodeKind } from '../../data/nodes';
import { indexById, isStale, staleRuns, type Graph, type StaleRun } from './graph';
import type { Item } from './item-types';
import type { DecisionEvent, Link, Run } from './types';

// What the UI shows about upstream changes (docs/data-model.md § "Staleness").
//   Item level — an item whose Link points at an upstream that moved past toVersionSeen.
//   Run level  — the latest run of a task on a node read inputs that changed since (covers outputs
//                without Links, e.g. personas generated from the brief).

export interface StaleUpstream {
  link: Link;
  upstream: Item;
}

export interface StaleInfo {
  item: Item;
  changes: StaleUpstream[];
}

/** Live items whose upstream changed, keyed by item id (pass the live graph). */
export function staleIndex(graph: Graph): Map<string, StaleInfo> {
  const byId = indexById(graph.items);
  const out = new Map<string, StaleInfo>();
  for (const link of graph.links) {
    if (!isStale(link, byId)) continue;
    const item = byId.get(link.from);
    const upstream = byId.get(link.to);
    if (!item || !upstream) continue;
    const info = out.get(item.id) ?? { item, changes: [] };
    info.changes.push({ link, upstream });
    out.set(item.id, info);
  }
  return out;
}

export function staleOnNode(index: ReadonlyMap<string, StaleInfo>, node: NodeKind): StaleInfo[] {
  return [...index.values()].filter((s) => s.item.node === node);
}

/**
 * The body an item had at `version`, when an `edited` event kept it (`prevBody`): the event that
 * moved the item from that version. Undefined when nothing was kept (old data, oversized body).
 */
export function bodyAtVersion(events: readonly DecisionEvent[], itemId: string, version: number): unknown {
  const edit = events.find((e) => e.itemId === itemId && e.kind === 'edited' && e.fromVersion === version);
  return edit?.prevBody;
}

/** The newest non-failed run per task on the node (runs come newest first). */
export function latestRunsByTask(runs: readonly Run[], node: NodeKind): Run[] {
  const seen = new Set<string>();
  const out: Run[] = [];
  for (const run of runs) {
    if (run.node !== node || run.status === 'failed' || seen.has(run.task)) continue;
    seen.add(run.task);
    out.push(run);
  }
  return out;
}

/** Run-level staleness of a node: its latest runs whose prompt inputs changed or were deleted since. */
export function nodeRunStaleness(runs: readonly Run[], items: readonly Item[], node: NodeKind): StaleRun[] {
  return staleRuns(latestRunsByTask(runs, node), items);
}

/** Order-independent fingerprint of the changed inputs (what a "noted" acknowledgement is keyed by). */
export function changedInputsKey(stale: readonly StaleRun[]): string {
  const refs = stale.flatMap((s) => s.changed.map((c) => `${c.itemId}@${c.current ?? 'x'}`));
  return [...new Set(refs)].sort().join(',');
}
