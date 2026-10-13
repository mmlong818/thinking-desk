import type { NodeKind } from '../../data/nodes';
import type { IdAllocator } from './ids';
import { deepEqual } from './json';
import {
  isSingletonType,
  parseBody,
  readRefValues,
  typeAllowedOn,
  typeDef,
  type Item,
  type RefDecl,
} from './item-types';
import type { IngestIssue, ItemDraft } from './repository';
import type { ItemType, Link } from './types';

// AI output → permanent ids + Links. AI entities carry temporary ids ('p1',
// 'j3'); refs between them, or to existing items by permanent id, become
// Links. See docs/data-model.md § "AI temp ids".

/**
 * new    — a fresh item gets a permanent id
 * update — rewrite an existing AI-pending item (echo) or the node's singleton
 * keep   — echo of a judged / human-touched item: left untouched, refs resolve to it
 */
export type DraftTarget = 'new' | 'update' | 'keep';

export interface ResolvedDraft {
  index: number;
  draft: ItemDraft;
  node: NodeKind;
  /** Validated body (stripped of id / ref fields). */
  body: unknown;
  itemId: string;
  target: DraftTarget;
  existing?: Item;
  bodyChanged: boolean;
}

interface KeyEntry {
  itemId: string;
  node: NodeKind;
}

export interface Classification {
  resolved: ResolvedDraft[];
  /** `${type}:${ref}` → resolved item. */
  keyMap: Map<string, KeyEntry>;
  issues: IngestIssue[];
}

export const refKey = (type: ItemType, ref: string): string => `${type}:${ref}`;

/** Judged or human-touched items are never rewritten or retired by an AI run. */
export function isProtected(item: Item): boolean {
  return item.origin !== 'ai' || item.decision !== 'pending';
}

function findSingleton(liveById: ReadonlyMap<string, Item>, node: NodeKind, type: ItemType): Item | undefined {
  for (const item of liveById.values()) {
    if (item.node === node && item.type === type) return item;
  }
  return undefined;
}

type Base = Pick<ResolvedDraft, 'index' | 'draft' | 'node' | 'body'>;

function fromExisting(base: Base, existing: Item, target: 'update' | 'keep'): ResolvedDraft {
  if (target === 'keep') return { ...base, body: existing.body, itemId: existing.id, target, existing, bodyChanged: false };
  const bodyChanged = !deepEqual(existing.body, base.body);
  return { ...base, itemId: existing.id, target, existing, bodyChanged };
}

interface ClassifyCtx {
  liveById: ReadonlyMap<string, Item>;
  runNode: NodeKind;
  alloc: IdAllocator;
  singletons: Set<string>;
  issues: IngestIssue[];
}

function classifyOne(draft: ItemDraft, index: number, ctx: ClassifyCtx): ResolvedDraft | null {
  const { type } = draft;
  const node = draft.node ?? ctx.runNode;
  if (!typeAllowedOn(type, node)) {
    ctx.issues.push({ kind: 'node_not_allowed', index, type, node });
    return null;
  }
  const parsed = parseBody(type, draft.body);
  if (!parsed.ok) {
    ctx.issues.push({ kind: 'invalid_body', index, type, issues: parsed.issues });
    return null;
  }
  const base: Base = { index, draft, node, body: parsed.body };
  if (isSingletonType(type)) {
    if (ctx.singletons.has(`${node}:${type}`)) {
      ctx.issues.push({ kind: 'duplicate_singleton', index, type });
      return null;
    }
    ctx.singletons.add(`${node}:${type}`);
    const current = findSingleton(ctx.liveById, node, type);
    if (current) return fromExisting(base, current, 'update');
  }
  const echo = draft.ref ? ctx.liveById.get(draft.ref) : undefined;
  if (echo && echo.type === type && echo.node === node) {
    return fromExisting(base, echo, isProtected(echo) ? 'keep' : 'update');
  }
  return { ...base, itemId: ctx.alloc(typeDef(type).prefix), target: 'new', bodyChanged: true };
}

export function classifyDrafts(
  drafts: readonly ItemDraft[],
  liveById: ReadonlyMap<string, Item>,
  runNode: NodeKind,
  alloc: IdAllocator,
): Classification {
  const out: Classification = { resolved: [], keyMap: new Map(), issues: [] };
  const ctx: ClassifyCtx = { liveById, runNode, alloc, singletons: new Set(), issues: out.issues };
  drafts.forEach((draft, index) => {
    const r = classifyOne(draft, index, ctx);
    if (!r) return;
    out.resolved.push(r);
    if (!draft.ref) return;
    const key = refKey(draft.type, draft.ref);
    if (out.keyMap.has(key)) out.issues.push({ kind: 'duplicate_ref', index, type: draft.type, ref: draft.ref });
    else out.keyMap.set(key, { itemId: r.itemId, node: r.node });
  });
  return out;
}

type RefSpec = Pick<RefDecl, 'rel' | 'to' | 'node'>;

interface RefTuple {
  r: ResolvedDraft;
  spec: RefSpec;
  path: string;
  value: string;
}

function refTuples(r: ResolvedDraft): RefTuple[] {
  const fromBody = typeDef(r.draft.type).refs.flatMap((decl) =>
    readRefValues(r.draft.body, decl.path).map((value) => ({ r, spec: decl, path: decl.path.join('.'), value })),
  );
  const extra = (r.draft.links ?? []).map((l) => ({
    r, spec: { rel: l.rel, to: l.to, node: l.node }, path: '(links)', value: l.ref,
  }));
  return [...fromBody, ...extra];
}

/** Same-output temp ids win over existing permanent ids; target type (and node) must match. */
export function resolveRef(
  value: string,
  spec: RefSpec,
  keyMap: ReadonlyMap<string, KeyEntry>,
  liveById: ReadonlyMap<string, Item>,
): string | undefined {
  for (const t of spec.to) {
    const hit = keyMap.get(refKey(t, value));
    if (hit && (!spec.node || hit.node === spec.node)) return hit.itemId;
  }
  const existing = liveById.get(value);
  if (existing && spec.to.includes(existing.type) && (!spec.node || existing.node === spec.node)) return existing.id;
  return undefined;
}

export interface LinkContext {
  projectId: string;
  liveById: ReadonlyMap<string, Item>;
  /** Items retired by this run: refs to them are dropped. */
  retired: ReadonlySet<string>;
  /** Version of `to` the link records as seen. */
  versionSeen: (itemId: string) => number;
  existingLinks: readonly Link[];
  alloc: IdAllocator;
}

export const linkKey = (from: string, to: string, rel: string): string => `${from}|${to}|${rel}`;

export function buildLinks(c: Classification, ctx: LinkContext): { links: Link[]; issues: IngestIssue[] } {
  const links: Link[] = [];
  const issues: IngestIssue[] = [];
  const seen = new Set(ctx.existingLinks.map((l) => linkKey(l.from, l.to, l.rel)));
  const tuples = c.resolved.filter((r) => r.target !== 'keep').flatMap(refTuples);
  for (const { r, spec, path, value } of tuples) {
    const to = resolveRef(value, spec, c.keyMap, ctx.liveById);
    if (!to || ctx.retired.has(to)) {
      issues.push({ kind: 'unresolved_ref', index: r.index, type: r.draft.type, path, value });
      continue;
    }
    const key = linkKey(r.itemId, to, spec.rel);
    if (to === r.itemId || seen.has(key)) continue;
    seen.add(key);
    links.push({
      id: ctx.alloc('lnk'), projectId: ctx.projectId, from: r.itemId, to, rel: spec.rel,
      toVersionSeen: ctx.versionSeen(to),
    });
  }
  return { links, issues };
}
