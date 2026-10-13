import type { Item } from './item-types';
import type { ItemRef, Link, Run } from './types';

export interface Graph {
  items: Item[];
  links: Link[];
}

export function indexById<T extends { id: string }>(xs: readonly T[]): Map<string, T> {
  return new Map(xs.map((x) => [x.id, x]));
}

/** Non-deleted items, and only the links whose both endpoints are among them. */
export function liveGraph(items: readonly Item[], links: readonly Link[]): Graph {
  const live = items.filter((i) => !i.deletedAt);
  const ids = new Set(live.map((i) => i.id));
  return { items: live, links: links.filter((l) => ids.has(l.from) && ids.has(l.to)) };
}

type ItemLookup = readonly Item[] | ReadonlyMap<string, Item>;

function lookup(items: ItemLookup): ReadonlyMap<string, Item> {
  return Array.isArray(items) ? indexById(items as readonly Item[]) : (items as ReadonlyMap<string, Item>);
}

/** `from` is stale when its upstream `to` moved past the version the link last saw. */
export function isStale(link: Link, items: ItemLookup): boolean {
  const to = lookup(items).get(link.to);
  if (!to || to.deletedAt) return false;
  return to.version > link.toVersionSeen;
}

export interface StaleItem {
  item: Item;
  /** Outgoing links whose upstream changed. */
  links: Link[];
}

export function staleItems(graph: Graph): StaleItem[] {
  const byId = indexById(graph.items);
  const staleByFrom = new Map<string, Link[]>();
  for (const link of graph.links) {
    if (!isStale(link, byId)) continue;
    staleByFrom.set(link.from, [...(staleByFrom.get(link.from) ?? []), link]);
  }
  const out: StaleItem[] = [];
  for (const [fromId, links] of staleByFrom) {
    const item = byId.get(fromId);
    if (item && !item.deletedAt) out.push({ item, links });
  }
  return out;
}

export interface ChangedInput {
  itemId: string;
  seen: number;
  /** null when the input item has since been deleted. */
  current: number | null;
}

export interface StaleRun {
  run: Run;
  changed: ChangedInput[];
}

function changedInput(ref: ItemRef, byId: ReadonlyMap<string, Item>): ChangedInput | null {
  const item = byId.get(ref.itemId);
  if (!item || item.deletedAt) return { itemId: ref.itemId, seen: ref.version, current: null };
  return item.version > ref.version ? { itemId: ref.itemId, seen: ref.version, current: item.version } : null;
}

/**
 * Node-level staleness: runs whose prompt inputs changed after the run.
 * Complements link staleness for outputs that carry no explicit cross-refs.
 */
export function staleRuns(runs: readonly Run[], items: ItemLookup): StaleRun[] {
  const byId = lookup(items);
  const out: StaleRun[] = [];
  for (const run of runs) {
    if (run.status === 'failed') continue;
    const changed = run.inputs
      .map((ref) => changedInput(ref, byId))
      .filter((c): c is ChangedInput => c !== null);
    if (changed.length > 0) out.push({ run, changed });
  }
  return out;
}
