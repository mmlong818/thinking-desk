import { indexById } from './graph';
import { createIdAllocator, type IdAllocator, type IdSource } from './ids';
import { buildLinks, classifyDrafts, type ResolvedDraft } from './ingest';
import { asItem, type Item } from './item-types';
import { makeEvent, type EventSpec } from './events';
import { retireCandidates } from './regenerate';
import { RepositoryError, type IngestIssue, type RunOutputInput, type SaveRunResult } from './repository';
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
  const edited: EventSpec = { itemId: existing.id, kind: 'edited', fromVersion: v, toVersion: v + 1, actor: 'ai', note };
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

function emptyPlan(run: Run): RunPlan {
  return {
    run, created: [], updated: [], retired: [], linksAdded: [], linksRemoved: [], events: [], idMap: {}, issues: [],
  };
}

export function planRunOutput(state: PlanState, input: RunOutputInput, ctx: PlanContext): RunPlan {
  const alloc = allocatorFor(state, ctx);
  const run = buildRun(input.run, ctx, alloc);
  if (run.status === 'failed') return emptyPlan(run);

  const live = state.items.filter((i) => !i.deletedAt);
  const liveById = indexById(live);
  const c = classifyDrafts(input.drafts, liveById, run.node, alloc);
  const touched = new Set(c.resolved.filter((r) => r.target !== 'new').map((r) => r.itemId));
  const retiredIds = new Set(retireCandidates(live, input.replace, touched).map((i) => i.id));
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
    issues: [...c.issues, ...linkResult.issues],
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
