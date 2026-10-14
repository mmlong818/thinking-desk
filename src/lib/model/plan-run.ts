import { indexById } from './graph';
import { createIdAllocator, type IdAllocator, type IdSource } from './ids';
import { buildLinks, classifyDrafts, type Classification, type ResolvedDraft } from './ingest';
import { asItem, isSingletonType, type Item } from './item-types';
import { keptPrevBody, makeEvent, type EventSpec } from './events';
import { bodySummary, shortName } from './feedback';
import { humanizeIds } from './humanize-ids';
import { retireCandidates } from './regenerate';
import {
  RepositoryError, type IngestIssue, type ReplaceScope, type RunOutputInput, type SaveRunResult,
} from './repository';
import { RunSchema, type DecisionEvent, type Link, type Run } from './types';

// Pure planner for Repository.saveRunOutput. Storage adapters apply the plan
// atomically (one localStorage write / one Postgres transaction).

export interface PlanState {
  /** All items of the project, including soft-deleted ones. */
  items: readonly Item[];
  links: readonly Link[];
  /** Other ids already used in the project (runs, events) to avoid. */
  takenIds?: Iterable<string>;
}

export interface PlanContext {
  projectId: string;
  /** ISO timestamp applied to everything the plan writes. */
  now: string;
  idSource?: IdSource;
}

export interface RunPlan {
  run: Run;
  created: Item[];
  updated: Item[];
  retired: Item[];
  linksAdded: Link[];
  linksRemoved: string[];
  events: DecisionEvent[];
  idMap: Record<string, string>;
  issues: IngestIssue[];
}

export function allocatorFor(state: PlanState, ctx: PlanContext): IdAllocator {
  const taken = [...state.items.map((i) => i.id), ...state.links.map((l) => l.id), ...(state.takenIds ?? [])];
  return createIdAllocator(taken, ctx.idSource);
}

function buildRun(input: RunOutputInput['run'], ctx: PlanContext, alloc: IdAllocator): Run {
  const parsed = RunSchema.safeParse({ ...input, id: alloc('run'), projectId: ctx.projectId, createdAt: ctx.now });
  if (!parsed.success) throw new RepositoryError('invalid', `invalid run: ${parsed.error.message}`);
  return parsed.data;
}

function newItem(r: ResolvedDraft, run: Run, ctx: PlanContext): Item {
  const { aiStance, evidence } = r.draft;
  return asItem({
    id: r.itemId, projectId: ctx.projectId, node: r.node, type: r.draft.type, body: r.body,
    origin: 'ai', decision: 'pending',
    ...(aiStance ? { aiStance } : {}), ...(evidence ? { evidence } : {}),
    version: 1, runId: run.id, createdAt: ctx.now, updatedAt: ctx.now,
  });
}

/** AI rewrite of an existing item: new version, back to AI-pending. */
function rewrittenItem(r: ResolvedDraft, existing: Item, run: Run, ctx: PlanContext): Item {
  const { decisionNote: _note, aiStance: _stance, evidence: _evidence, ...rest } = existing;
  const { aiStance, evidence } = r.draft;
  return asItem({
    ...rest, body: r.body, origin: 'ai', decision: 'pending',
    ...(aiStance ? { aiStance } : {}), ...(evidence ? { evidence } : {}),
    version: existing.version + 1, runId: run.id, updatedAt: ctx.now,
  });
}

function rewriteEvents(existing: Item, run: Run): EventSpec[] {
  const v = existing.version;
  const note = `run ${run.id}`;
  // A singleton is rewritten in place even when judged: its old body is always kept.
  const prevBody = keptPrevBody(existing.body, isSingletonType(existing.type));
  const edited: EventSpec = {
    itemId: existing.id, kind: 'edited', fromVersion: v, toVersion: v + 1, actor: 'ai', note,
    ...(prevBody !== undefined ? { prevBody } : {}),
  };
  if (existing.decision === 'pending') return [edited];
  return [edited, { itemId: existing.id, kind: 'reset', fromVersion: v + 1, toVersion: v + 1, actor: 'ai', note }];
}

function materialize(resolved: readonly ResolvedDraft[], run: Run, ctx: PlanContext) {
  const created: Item[] = [];
  const updated: Item[] = [];
  const specs: EventSpec[] = [];
  for (const r of resolved) {
    if (r.target === 'new') {
      created.push(newItem(r, run, ctx));
      specs.push({ itemId: r.itemId, kind: 'created', fromVersion: 0, toVersion: 1, actor: 'ai', note: `run ${run.id}` });
    } else if (r.target === 'update' && r.bodyChanged && r.existing) {
      updated.push(rewrittenItem(r, r.existing, run, ctx));
      specs.push(...rewriteEvents(r.existing, run));
    }
  }
  return { created, updated, specs };
}

function versionSeenFn(run: Run, liveById: ReadonlyMap<string, Item>, written: readonly Item[]) {
  const writtenVersion = new Map(written.map((i) => [i.id, i.version]));
  const inputVersion = new Map(run.inputs.map((ref) => [ref.itemId, ref.version]));
  return (id: string): number => {
    const w = writtenVersion.get(id);
    if (w !== undefined) return w;
    const current = liveById.get(id)?.version ?? 1;
    const seen = inputVersion.get(id);
    return seen !== undefined ? Math.min(seen, current) : current;
  };
}

/** Names for the ids the AI may cite in prose: live items by id, this run's drafts by their temp ref. */
function idNames(live: readonly Item[], resolved: readonly ResolvedDraft[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const i of live) names.set(i.id, shortName(bodySummary(i.type, i.body)));
  for (const r of resolved) {
    const ref = r.draft.ref;
    // Temp refs like "alt_07" / "p9"; a bare word without a digit could be ordinary prose.
    if (ref && ref.length >= 2 && /\d/.test(ref)) names.set(ref, shortName(bodySummary(r.draft.type, r.body)));
  }
  return names;
}

function emptyPlan(run: Run, issues: IngestIssue[] = []): RunPlan {
  return {
    run, created: [], updated: [], retired: [], linksAdded: [], linksRemoved: [], events: [], idMap: {}, issues,
  };
}

/**
 * A run that was asked for output but yielded no valid item fails as a whole and changes nothing —
 * unless it returned nothing at all for scopes that are all `exhaustive` (an empty answer is valid).
 */
function noOutputError(input: RunOutputInput, c: Classification): string | null {
  if (c.resolved.length > 0 || (input.drafts.length === 0 && input.replace.length === 0)) return null;
  if (input.drafts.length === 0) {
    return input.replace.every((s) => s.exhaustive) ? null : 'run produced no items';
  }
  return `run produced no valid items (${input.drafts.length} drafts rejected)`;
}

/**
 * Replace scopes that received at least one valid draft; empty scopes keep their pending items.
 * An `exhaustive` scope always counts as filled: its pending items go even when it got nothing.
 */
function filledScopes(replace: readonly ReplaceScope[], c: Classification) {
  const filled = replace.filter((s) => s.exhaustive || c.resolved.some((r) => r.node === s.node && r.draft.type === s.type));
  const issues: IngestIssue[] = replace
    .filter((s) => !filled.includes(s))
    .map((s) => ({ kind: 'empty_scope', node: s.node, type: s.type }));
  return { filled, issues };
}

export function planRunOutput(state: PlanState, input: RunOutputInput, ctx: PlanContext): RunPlan {
  const alloc = allocatorFor(state, ctx);
  const run = buildRun(input.run, ctx, alloc);
  if (run.status === 'failed') return emptyPlan(run);

  const live = state.items.filter((i) => !i.deletedAt);
  const liveById = indexById(live);
  const c = classifyDrafts(input.drafts, liveById, run.node, alloc);
  const names = idNames(live, c.resolved);
  c.resolved = c.resolved.map((r) => ({ ...r, body: humanizeIds(r.body, names) }));
  const error = noOutputError(input, c);
  if (error) return emptyPlan({ ...run, status: 'failed', error }, c.issues);
  const scopes = filledScopes(input.replace, c);
  const touched = new Set(c.resolved.filter((r) => r.target !== 'new').map((r) => r.itemId));
  const retiredIds = new Set(retireCandidates(live, scopes.filled, touched).map((i) => i.id));
  const { created, updated, specs } = materialize(c.resolved, run, ctx);
  const linkResult = buildLinks(c, {
    projectId: ctx.projectId, liveById, retired: retiredIds, alloc,
    versionSeen: versionSeenFn(run, liveById, [...created, ...updated]),
    existingLinks: state.links,
  });

  const retired = live
    .filter((i) => retiredIds.has(i.id))
    .map((i) => asItem({ ...i, deletedAt: ctx.now, updatedAt: ctx.now }));
  const retireSpecs: EventSpec[] = retired.map((i) => ({
    itemId: i.id, kind: 'deleted', fromVersion: i.version, toVersion: i.version, actor: 'ai',
    note: `superseded by run ${run.id}`,
  }));
  const events = [...specs, ...retireSpecs].map((s) => makeEvent(s, ctx.projectId, ctx.now, alloc));
  return {
    run, created, updated, retired, events,
    linksAdded: linkResult.links,
    linksRemoved: state.links.filter((l) => retiredIds.has(l.from) || retiredIds.has(l.to)).map((l) => l.id),
    idMap: Object.fromEntries([...c.keyMap].map(([k, v]) => [k, v.itemId])),
    issues: [...c.issues, ...linkResult.issues, ...scopes.issues],
  };
}

export function toSaveRunResult(plan: RunPlan): SaveRunResult {
  return {
    run: plan.run,
    created: plan.created,
    updated: plan.updated,
    retired: plan.retired.map((i) => i.id),
    links: plan.linksAdded,
    idMap: plan.idMap,
    issues: plan.issues,
  };
}
