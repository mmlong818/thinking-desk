import { liveGraph, type Graph } from './graph';
import type { IdSource } from './ids';
import type { Item } from './item-types';
import { decodeDoc, hasLoss, type DecodeReport, type ProjectDoc } from './local-doc';
import { planCreateItem, planItemUpdate, planRefreshLinks } from './plan-item';
import { planRunOutput, toSaveRunResult, type PlanContext, type PlanState, type RunPlan } from './plan-run';
import {
  RepositoryError,
  type CreateItemInput,
  type EventFilter,
  type EventMeta,
  type ItemFilter,
  type ItemPatch,
  type Repository,
  type RunFilter,
  type RunOutputInput,
  type SaveRunResult,
} from './repository';
import type { DecisionEvent, Link, Run } from './types';

// Pure-local persistence: one localStorage value per project. Every method is
// a synchronous read-modify-write inside one tick, so a single setItem makes
// each write atomic. Two tabs writing the same project: last write wins.

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CorruptionInfo {
  projectId: string;
  report: DecodeReport;
  /** The undecodable raw value was copied here (unless a backup already existed). */
  backupKey: string;
}

export interface LocalRepositoryOptions {
  /** Defaults to window.localStorage, resolved lazily so SSR imports are safe. */
  storage?: StorageLike;
  now?: () => string;
  idSource?: IdSource;
  onCorrupt?: (info: CorruptionInfo) => void;
}

export const localProjectKey = (projectId: string): string => `td:v2:${projectId}`;
export const localBackupKey = (projectId: string): string => `td:v2-corrupt:${projectId}`;

function replaceById<T extends { id: string }>(list: readonly T[], next: readonly T[]): T[] {
  const byId = new Map(next.map((x) => [x.id, x]));
  return list.map((x) => byId.get(x.id) ?? x);
}

export function itemMatches(filter: ItemFilter) {
  return (i: Item): boolean =>
    (filter.includeDeleted || !i.deletedAt) &&
    (!filter.node || i.node === filter.node) &&
    (!filter.type || i.type === filter.type) &&
    (!filter.decision || i.decision === filter.decision);
}

function applyRunPlan(doc: ProjectDoc, plan: RunPlan): ProjectDoc {
  const removed = new Set(plan.linksRemoved);
  return {
    ...doc,
    items: [...replaceById(doc.items, [...plan.updated, ...plan.retired]), ...plan.created],
    links: [...doc.links.filter((l) => !removed.has(l.id)), ...plan.linksAdded],
    runs: [...doc.runs, plan.run],
    events: [...doc.events, ...plan.events],
  };
}

function planState(doc: ProjectDoc): PlanState {
  return { items: doc.items, links: doc.links, takenIds: [...doc.runs, ...doc.events].map((x) => x.id) };
}

export class LocalRepository implements Repository {
  constructor(private readonly opts: LocalRepositoryOptions = {}) {}

  private storage(): StorageLike {
    const s = this.opts.storage ?? (typeof globalThis.localStorage === 'undefined' ? undefined : globalThis.localStorage);
    if (!s) throw new RepositoryError('storage', 'localStorage is not available');
    return s;
  }

  private ctx(projectId: string): PlanContext {
    const now = this.opts.now ? this.opts.now() : new Date().toISOString();
    return { projectId, now, idSource: this.opts.idSource };
  }

  private load(projectId: string): ProjectDoc {
    const storage = this.storage();
    const raw = storage.getItem(localProjectKey(projectId));
    const { doc, report } = decodeDoc(raw, projectId);
    if (raw !== null && hasLoss(report)) this.backup(storage, projectId, raw, report);
    return doc;
  }

  private backup(storage: StorageLike, projectId: string, raw: string, report: DecodeReport): void {
    const backupKey = localBackupKey(projectId);
    try {
      if (storage.getItem(backupKey) === null) storage.setItem(backupKey, raw);
    } catch {
      // Quota exhausted: still report the loss below.
    }
    this.opts.onCorrupt?.({ projectId, report, backupKey });
  }

  private save(projectId: string, doc: ProjectDoc): void {
    try {
      this.storage().setItem(localProjectKey(projectId), JSON.stringify(doc));
    } catch (e) {
      throw new RepositoryError('storage', `could not persist project ${projectId}`, { cause: e });
    }
  }

  async getGraph(projectId: string): Promise<Graph> {
    const doc = this.load(projectId);
    return liveGraph(doc.items, doc.links);
  }

  async listItems(projectId: string, filter: ItemFilter = {}): Promise<Item[]> {
    return this.load(projectId).items.filter(itemMatches(filter));
  }

  async saveRunOutput(projectId: string, output: RunOutputInput): Promise<SaveRunResult> {
    const doc = this.load(projectId);
    const plan = planRunOutput(planState(doc), output, this.ctx(projectId));
    this.save(projectId, applyRunPlan(doc, plan));
    return toSaveRunResult(plan);
  }

  async updateItem(projectId: string, itemId: string, patch: ItemPatch, event: EventMeta): Promise<Item> {
    const doc = this.load(projectId);
    const item = doc.items.find((i) => i.id === itemId);
    if (!item) throw new RepositoryError('not_found', `item ${itemId} not found`);
    const plan = planItemUpdate(item, patch, event, this.ctx(projectId), planState(doc).takenIds);
    if (plan.events.length === 0) return plan.item;
    this.save(projectId, { ...doc, items: replaceById(doc.items, [plan.item]), events: [...doc.events, ...plan.events] });
    return plan.item;
  }

  async createItem(projectId: string, input: CreateItemInput): Promise<Item> {
    const doc = this.load(projectId);
    const plan = planCreateItem(planState(doc), input, this.ctx(projectId));
    this.save(projectId, {
      ...doc,
      items: [...doc.items, plan.item],
      links: [...doc.links, ...plan.links],
      events: [...doc.events, ...plan.events],
    });
    return plan.item;
  }

  async refreshLinks(projectId: string, linkIds: readonly string[]): Promise<Link[]> {
    const doc = this.load(projectId);
    const refreshed = planRefreshLinks(planState(doc), linkIds);
    if (refreshed.length > 0) this.save(projectId, { ...doc, links: replaceById(doc.links, refreshed) });
    return refreshed;
  }

  async listRuns(projectId: string, filter: RunFilter = {}): Promise<Run[]> {
    return this.load(projectId)
      .runs.filter((r) => (!filter.node || r.node === filter.node) && (!filter.task || r.task === filter.task))
      .reverse();
  }

  async listEvents(projectId: string, filter: EventFilter = {}): Promise<DecisionEvent[]> {
    return this.load(projectId).events.filter((e) => !filter.itemId || e.itemId === filter.itemId);
  }
}
