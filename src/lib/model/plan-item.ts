import type { NodeKind } from '../../data/nodes';
import { indexById } from './graph';
import { decisionEventKind, makeEvent, type EventSpec } from './events';
import { deepEqual } from './json';
import { asItem, isSingletonType, parseBody, typeAllowedOn, typeDef, type Item } from './item-types';
import { allocatorFor, type PlanContext, type PlanState } from './plan-run';
import {
  RepositoryError,
  type CreateItemInput,
  type EventMeta,
  type ItemPatch,
} from './repository';
import type { DecisionEvent, Link, Origin } from './types';

// Pure planners for human-side writes: createItem, updateItem, refreshLinks.

export interface ItemWritePlan {
  item: Item;
  links: Link[];
  events: DecisionEvent[];
}

function validBody(type: Item['type'], raw: unknown): unknown {
  const parsed = parseBody(type, raw);
  if (!parsed.ok) throw new RepositoryError('invalid', `invalid ${type} body: ${parsed.issues.join('; ')}`);
  return parsed.body;
}

function linksFor(input: CreateItemInput, itemId: string, state: PlanState, ctx: PlanContext, alloc: (p: string) => string) {
  const liveById = indexById(state.items.filter((i) => !i.deletedAt));
  return (input.links ?? []).map((l): Link => {
    const to = liveById.get(l.to);
    if (!to) throw new RepositoryError('invalid', `link target ${l.to} does not exist`);
    return { id: alloc('lnk'), projectId: ctx.projectId, from: itemId, to: to.id, rel: l.rel, toVersionSeen: to.version };
  });
}

export function planCreateItem(state: PlanState, input: CreateItemInput, ctx: PlanContext): ItemWritePlan {
  const { node, type } = input;
  if (!typeAllowedOn(type, node)) throw new RepositoryError('invalid', `type ${type} is not allowed on node ${node}`);
  const body = validBody(type, input.body);
  if (isSingletonType(type) && state.items.some((i) => !i.deletedAt && i.node === node && i.type === type)) {
    throw new RepositoryError('conflict', `${node} already has a ${type}; update it instead`);
  }
  const alloc = allocatorFor(state, ctx);
  const id = alloc(typeDef(type).prefix);
  const decision = input.decision ?? 'accepted';
  const note = input.decisionNote;
  const item = asItem({
    id, projectId: ctx.projectId, node, type, body, origin: 'human', decision,
    ...(note ? { decisionNote: note } : {}),
    version: 1, createdAt: ctx.now, updatedAt: ctx.now,
  });
  const links = linksFor(input, id, state, ctx, alloc);
  const specs: EventSpec[] = [{ itemId: id, kind: 'created', fromVersion: 0, toVersion: 1, actor: 'human' }];
  if (decision !== 'pending') {
    specs.push({ itemId: id, kind: decisionEventKind(decision), fromVersion: 1, toVersion: 1, actor: 'human', note });
  }
  return { item, links, events: specs.map((s) => makeEvent(s, ctx.projectId, ctx.now, alloc)) };
}

function editedOrigin(origin: Origin, actor: EventMeta['actor']): Origin {
  if (actor === 'ai') return 'ai';
  return origin === 'ai' ? 'ai_edited' : origin;
}

type Step = { item: Item; specs: EventSpec[] };

function applyBody(step: Step, raw: unknown, event: EventMeta, now: string): Step {
  const { item } = step;
  const body = validBody(item.type, raw);
  if (deepEqual(body, item.body)) return step;
  const v = item.version;
  const specs: EventSpec[] = [
    ...step.specs,
    { itemId: item.id, kind: 'edited', fromVersion: v, toVersion: v + 1, actor: event.actor, note: event.note },
  ];
  const next = asItem({ ...item, body, version: v + 1, origin: editedOrigin(item.origin, event.actor), updatedAt: now });
  if (event.actor === 'human' || next.decision === 'pending') return { item: next, specs };
  // An AI rewrite always sends the item back to pending.
  const { decisionNote: _note, ...rest } = next;
  specs.push({ itemId: item.id, kind: 'reset', fromVersion: v + 1, toVersion: v + 1, actor: 'ai', note: event.note });
  return { item: asItem({ ...rest, decision: 'pending' }), specs };
}

function applyDecision(step: Step, patch: ItemPatch, event: EventMeta, now: string): Step {
  const { item } = step;
  const decision = patch.decision ?? item.decision;
  const changed = decision !== item.decision;
  const noteGiven = patch.decisionNote !== undefined;
  const note = noteGiven ? (patch.decisionNote ?? undefined) : changed ? undefined : item.decisionNote;
  if (!changed && note === item.decisionNote) return step;
  const { decisionNote: _old, ...rest } = item;
  const next = asItem({ ...rest, decision, ...(note ? { decisionNote: note } : {}), updatedAt: now });
  const spec: EventSpec = {
    itemId: item.id, kind: decisionEventKind(decision), fromVersion: item.version, toVersion: item.version,
    actor: event.actor, note: note ?? event.note,
  };
  return { item: next, specs: [...step.specs, spec] };
}

/** Returns the item unchanged and no events when the patch is a no-op. */
export function planItemUpdate(
  item: Item,
  patch: ItemPatch,
  event: EventMeta,
  ctx: PlanContext,
  takenIds: Iterable<string> = [],
): { item: Item; events: DecisionEvent[] } {
  if (item.deletedAt) throw new RepositoryError('conflict', `item ${item.id} is deleted`);
  const alloc = allocatorFor({ items: [item], links: [], takenIds }, ctx);
  let step: Step = { item, specs: [] };
  if (patch.deleted) {
    const v = item.version;
    step = {
      item: asItem({ ...item, deletedAt: ctx.now, updatedAt: ctx.now }),
      specs: [{ itemId: item.id, kind: 'deleted', fromVersion: v, toVersion: v, actor: event.actor, note: event.note }],
    };
  } else {
    if (patch.body !== undefined) step = applyBody(step, patch.body, event, ctx.now);
    if (patch.decision !== undefined || patch.decisionNote !== undefined) step = applyDecision(step, patch, event, ctx.now);
  }
  return { item: step.item, events: step.specs.map((s) => makeEvent(s, ctx.projectId, ctx.now, alloc)) };
}

export const ACCEPT_RECOMMENDED_NOTE = 'accept all recommended';

/** Live, pending items on `node` that the AI recommends (aiStance.verdict === 'recommend'). */
export function recommendedPending(items: readonly Item[], node: NodeKind): Item[] {
  return items.filter(
    (i) => !i.deletedAt && i.node === node && i.decision === 'pending' && i.aiStance?.verdict === 'recommend',
  );
}

/** Accepts every recommended pending item on `node`: one `accepted` event each, actor human. */
export function planAcceptRecommended(
  state: PlanState,
  node: NodeKind,
  ctx: PlanContext,
  note: string = ACCEPT_RECOMMENDED_NOTE,
): { items: Item[]; events: DecisionEvent[] } {
  const taken = [...(state.takenIds ?? [])];
  const items: Item[] = [];
  const events: DecisionEvent[] = [];
  for (const item of recommendedPending(state.items, node)) {
    const plan = planItemUpdate(item, { decision: 'accepted' }, { actor: 'human', note }, ctx, [
      ...taken, ...events.map((e) => e.id),
    ]);
    items.push(plan.item);
    events.push(...plan.events);
  }
  return { items, events };
}

/** toVersionSeen := current version of `to`. Unknown link ids are rejected. */
export function planRefreshLinks(state: PlanState, linkIds: readonly string[]): Link[] {
  const links = indexById(state.links);
  const items = indexById(state.items.filter((i) => !i.deletedAt));
  return linkIds.map((id) => {
    const link = links.get(id);
    if (!link) throw new RepositoryError('not_found', `link ${id} not found`);
    const to = items.get(link.to);
    if (!to) throw new RepositoryError('conflict', `link ${id} points to a deleted item`);
    return { ...link, toVersionSeen: to.version };
  });
}
