import type { NodeKind } from '../../data/nodes';
import type { Graph } from './graph';
import type { Item } from './item-types';
import type {
  Actor,
  AiStance,
  Decision,
  DecisionEvent,
  Evidence,
  ItemType,
  Link,
  LinkRel,
  Run,
  RunInput,
} from './types';

// Storage-agnostic contract. LocalRepository (browser localStorage) and
// PgRepository (src/lib/db) both delegate the decision logic to the pure
// planners in ./plan-*.ts, so they behave identically.

export interface ItemFilter {
  node?: NodeKind;
  type?: ItemType;
  decision?: Decision;
  includeDeleted?: boolean;
}

/** An extra cross-reference that is not embedded in the raw body (e.g. lineage). */
export interface DraftLink {
  ref: string;
  rel: LinkRel;
  to: readonly ItemType[];
  node?: NodeKind;
}

/** One entity of AI output, still carrying the AI's temporary id. */
export interface ItemDraft {
  /** Temp id from the AI output ('p1', 'j3'), or an existing permanent id the AI echoed. */
  ref?: string;
  type: ItemType;
  /** Defaults to the run's node. */
  node?: NodeKind;
  /** Raw entity; cross-ref fields declared in the type registry become Links. */
  body: unknown;
  aiStance?: AiStance;
  evidence?: Evidence;
  links?: readonly DraftLink[];
}

export interface ReplaceScope {
  node: NodeKind;
  type: ItemType;
}

export interface RunOutputInput {
  run: RunInput;
  drafts: readonly ItemDraft[];
  /**
   * (node, type) pairs this run regenerates: their untouched AI-pending items
   * are retired. Empty for additive runs ("give me 3 more"). Ignored for failed runs.
   */
  replace: readonly ReplaceScope[];
}

export type IngestIssue =
  | { kind: 'invalid_body'; index: number; type: ItemType; issues: string[] }
  | { kind: 'node_not_allowed'; index: number; type: ItemType; node: NodeKind }
  | { kind: 'duplicate_singleton'; index: number; type: ItemType }
  | { kind: 'duplicate_ref'; index: number; type: ItemType; ref: string }
  | { kind: 'unresolved_ref'; index: number; type: ItemType; path: string; value: string }
  /** A replace scope got no valid item from this run, so its pending items were kept rather than retired. */
  | { kind: 'empty_scope'; node: NodeKind; type: ItemType };

export interface SaveRunResult {
  run: Run;
  created: Item[];
  updated: Item[];
  /** Ids of AI-pending items retired (soft-deleted) by this run. */
  retired: string[];
  links: Link[];
  /** `${type}:${ref}` → permanent id, for every draft that carried a ref. */
  idMap: Record<string, string>;
  issues: IngestIssue[];
}

export interface CreateItemInput {
  node: NodeKind;
  type: ItemType;
  body: unknown;
  /** Human-authored items default to 'accepted'. */
  decision?: Decision;
  decisionNote?: string;
  links?: ReadonlyArray<{ to: string; rel: LinkRel }>;
}

export interface ItemPatch {
  body?: unknown;
  decision?: Decision;
  /** null clears the note. */
  decisionNote?: string | null;
  deleted?: true;
}

export interface EventMeta {
  actor: Actor;
  note?: string;
}

export interface RunFilter {
  node?: NodeKind;
  task?: string;
}

export interface EventFilter {
  itemId?: string;
}

export interface Repository {
  /** Live items and the links between them. */
  getGraph(projectId: string): Promise<Graph>;
  listItems(projectId: string, filter?: ItemFilter): Promise<Item[]>;
  /** Atomic: records the run, ingests drafts, applies regeneration semantics. */
  saveRunOutput(projectId: string, output: RunOutputInput): Promise<SaveRunResult>;
  /** Bumps version only when the body changes; appends one DecisionEvent per change. */
  updateItem(projectId: string, itemId: string, patch: ItemPatch, event: EventMeta): Promise<Item>;
  /** Human-authored item (origin 'human'). */
  createItem(projectId: string, input: CreateItemInput): Promise<Item>;
  /**
   * Atomic: accepts every live, pending item on `node` whose aiStance.verdict is 'recommend',
   * one `accepted` event each (actor human). Returns the accepted items (empty when none qualify).
   */
  acceptRecommended(projectId: string, node: NodeKind, meta?: { note?: string }): Promise<Item[]>;
  /** Marks links as reviewed: toVersionSeen := current version of `to`. */
  refreshLinks(projectId: string, linkIds: readonly string[]): Promise<Link[]>;
  /** Newest first. */
  listRuns(projectId: string, filter?: RunFilter): Promise<Run[]>;
  /** Oldest first (append order). */
  listEvents(projectId: string, filter?: EventFilter): Promise<DecisionEvent[]>;
}

export type RepositoryErrorCode = 'not_found' | 'invalid' | 'conflict' | 'storage';

export class RepositoryError extends Error {
  readonly code: RepositoryErrorCode;

  constructor(code: RepositoryErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'RepositoryError';
    this.code = code;
  }
}
