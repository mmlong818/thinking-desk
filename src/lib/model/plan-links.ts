import { indexById } from './graph';
import { makeEvent, type EventSpec } from './events';
import type { Item } from './item-types';
import { createsCycle, linkAllowed } from './link-rules';
import { allocatorFor, type PlanContext, type PlanState } from './plan-run';
import { RepositoryError, type EventMeta, type LinkEdit } from './repository';
import type { DecisionEvent, EventKind, Link } from './types';

// Pure planners for human-side Link writes: editing Links by hand (add / remove) and confirming
// that an item still holds after its upstream changed (refresh). Each change is one DecisionEvent
// on the link's `from` item (link_added / link_removed / link_confirmed, carrying the link);
// none of them changes an item's version.

export interface LinkEditPlan {
  added: Link[];
  removed: Link[];
  events: DecisionEvent[];
}

function linkEvent(kind: EventKind, link: Link, byId: ReadonlyMap<string, Item>, meta: EventMeta): EventSpec {
  const v = byId.get(link.from)?.version ?? 1;
  return {
    itemId: link.from, kind, fromVersion: v, toVersion: v, actor: meta.actor, note: meta.note,
    link: { id: link.id, to: link.to, rel: link.rel },
  };
}

function removeAll(links: Link[], ids: readonly string[]): { rest: Link[]; removed: Link[] } {
  const removed: Link[] = [];
  let rest = links;
  for (const id of new Set(ids)) {
    const link = rest.find((l) => l.id === id);
    if (!link) throw new RepositoryError('not_found', `link ${id} not found`);
    rest = rest.filter((l) => l.id !== id);
    removed.push(link);
  }
  return { rest, removed };
}

function liveItem(byId: ReadonlyMap<string, Item>, id: string): Item {
  const item = byId.get(id);
  if (!item || item.deletedAt) throw new RepositoryError('not_found', `item ${id} not found`);
  return item;
}

/**
 * Removes, then adds (so one edit can move a link). Adding is idempotent: an existing
 * (from, to, rel) is left as it is. Rejects self-links, pairs the type registry does not allow
 * and depends_on links that would close a cycle.
 */
export function planEditLinks(state: PlanState, edit: LinkEdit, meta: EventMeta, ctx: PlanContext): LinkEditPlan {
  const byId = indexById(state.items);
  const alloc = allocatorFor(state, ctx);
  const { rest, removed } = removeAll([...state.links], edit.remove ?? []);
  const links = rest;
  const added: Link[] = [];
  for (const spec of edit.add ?? []) {
    const from = liveItem(byId, spec.from);
    const to = liveItem(byId, spec.to);
    if (from.id === to.id) throw new RepositoryError('invalid', `item ${from.id} cannot link to itself`);
    if (!linkAllowed(from, spec.rel, to)) {
      throw new RepositoryError('invalid', `${from.type}@${from.node} —${spec.rel}→ ${to.type}@${to.node} is not an allowed link`);
    }
    if (links.some((l) => l.from === from.id && l.to === to.id && l.rel === spec.rel)) continue;
    if (spec.rel === 'depends_on' && createsCycle(links, from.id, to.id)) {
      throw new RepositoryError('conflict', `${from.id} depends_on ${to.id} would create a dependency cycle`);
    }
    const link: Link = { id: alloc('lnk'), projectId: ctx.projectId, from: from.id, to: to.id, rel: spec.rel, toVersionSeen: to.version };
    links.push(link);
    added.push(link);
  }
  const specs = [
    ...removed.map((l) => linkEvent('link_removed', l, byId, meta)),
    ...added.map((l) => linkEvent('link_added', l, byId, meta)),
  ];
  return { added, removed, events: specs.map((s) => makeEvent(s, ctx.projectId, ctx.now, alloc)) };
}

/**
 * toVersionSeen := current version of `to` ("still holds after the upstream change"). Unknown link
 * ids are rejected. Returns every requested link; only the ones that moved get a link_confirmed event.
 */
export function planRefreshLinks(
  state: PlanState, linkIds: readonly string[], meta: EventMeta, ctx: PlanContext,
): { links: Link[]; changed: Link[]; events: DecisionEvent[] } {
  const links = indexById(state.links);
  const byId = indexById(state.items);
  const refreshed = [...new Set(linkIds)].map((id) => {
    const link = links.get(id);
    if (!link) throw new RepositoryError('not_found', `link ${id} not found`);
    const to = byId.get(link.to);
    if (!to || to.deletedAt) throw new RepositoryError('conflict', `link ${id} points to a deleted item`);
    return { ...link, toVersionSeen: to.version };
  });
  const changed = refreshed.filter((l) => l.toVersionSeen !== links.get(l.id)?.toVersionSeen);
  const alloc = allocatorFor(state, ctx);
  const events = changed.map((l) => makeEvent(linkEvent('link_confirmed', l, byId, meta), ctx.projectId, ctx.now, alloc));
  return { links: refreshed, changed, events };
}
