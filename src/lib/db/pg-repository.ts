import { query as poolQuery, withTransaction as poolTransaction, type SqlExecutor } from './client';
import {
  itemToJson, mapRows, rowToEvent, rowToItem, rowToLink, rowToRun,
  type EventRow, type ItemRow, type LinkRow, type RunRow,
} from './pg-rows';
import { liveGraph, type Graph } from '../model/graph';
import type { IdSource } from '../model/ids';
import type { Item } from '../model/item-types';
import { planCreateItem, planItemUpdate, planRefreshLinks } from '../model/plan-item';
import { planRunOutput, toSaveRunResult, type PlanContext, type PlanState, type RunPlan } from '../model/plan-run';
import {
  RepositoryError,
  type CreateItemInput, type EventFilter, type EventMeta, type ItemFilter, type ItemPatch,
  type Repository, type RunFilter, type RunOutputInput, type SaveRunResult,
} from '../model/repository';
import type { DecisionEvent, Link, Run } from '../model/types';

// Server-side Repository over Postgres (schema.sql: items / links / runs /
// decision_events). Every write locks the project row, loads the state,
// runs the same pure planner as LocalRepository and applies the plan in one
// transaction. Like every db/ caller, it rejects without DATABASE_URL.

type Transaction = <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;

export interface PgRepositoryDeps {
  query?: SqlExecutor['query'];
  withTransaction?: Transaction;
  now?: () => string;
  idSource?: IdSource;
  /** Called with the number of stored rows that failed validation and were skipped. */
  onInvalidRows?: (table: string, count: number) => void;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SQL = {
  lockProject: 'SELECT id FROM projects WHERE id = $1 FOR UPDATE',
  selectItems: 'SELECT * FROM items WHERE project_id = $1 ORDER BY seq',
  selectLiveItems: 'SELECT * FROM items WHERE project_id = $1 AND deleted_at IS NULL ORDER BY seq',
  selectItem: 'SELECT * FROM items WHERE project_id = $1 AND id = $2',
  selectLinks: 'SELECT * FROM links WHERE project_id = $1',
  insertRun: `INSERT INTO runs (project_id, id, task, node, provider, model, prompt_version,
                      inputs, status, error, usage, latency_ms, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11::jsonb, $12, $13)`,
  insertItems: `INSERT INTO items (project_id, id, node, type, body, origin, decision, decision_note,
                       ai_stance, evidence, version, run_id, created_at, updated_at, deleted_at)
    SELECT $1::uuid, e.v->>'id', e.v->>'node', e.v->>'type', e.v->'body', e.v->>'origin', e.v->>'decision',
           e.v->>'decision_note', e.v->'ai_stance', e.v->'evidence', (e.v->>'version')::int, e.v->>'run_id',
           (e.v->>'created_at')::timestamptz, (e.v->>'updated_at')::timestamptz, (e.v->>'deleted_at')::timestamptz
    FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS e(v, ord) ORDER BY e.ord`,
  overwriteItems: `UPDATE items AS i SET
      body = e.v->'body', origin = e.v->>'origin', decision = e.v->>'decision', decision_note = e.v->>'decision_note',
      ai_stance = e.v->'ai_stance', evidence = e.v->'evidence', version = (e.v->>'version')::int, run_id = e.v->>'run_id',
      updated_at = (e.v->>'updated_at')::timestamptz, deleted_at = (e.v->>'deleted_at')::timestamptz
    FROM jsonb_array_elements($2::jsonb) AS e(v)
    WHERE i.project_id = $1::uuid AND i.id = e.v->>'id'`,
  deleteLinks: 'DELETE FROM links WHERE project_id = $1 AND id = ANY($2::text[])',
  insertLinks: `INSERT INTO links (project_id, id, from_id, to_id, rel, to_version_seen)
    SELECT $1::uuid, e.v->>'id', e.v->>'from', e.v->>'to', e.v->>'rel', (e.v->>'toVersionSeen')::int
    FROM jsonb_array_elements($2::jsonb) AS e(v)`,
  refreshLinks: `UPDATE links AS l SET to_version_seen = (e.v->>'toVersionSeen')::int
    FROM jsonb_array_elements($2::jsonb) AS e(v)
    WHERE l.project_id = $1::uuid AND l.id = e.v->>'id'`,
  insertEvents: `INSERT INTO decision_events (project_id, id, item_id, kind, from_version, to_version, note, actor, at)
    SELECT $1::uuid, e.v->>'id', e.v->>'itemId', e.v->>'kind', (e.v->>'fromVersion')::int, (e.v->>'toVersion')::int,
           e.v->>'note', e.v->>'actor', (e.v->>'at')::timestamptz
    FROM jsonb_array_elements($2::jsonb) WITH ORDINALITY AS e(v, ord) ORDER BY e.ord`,
} as const;

function assertProjectId(projectId: string): void {
  if (!UUID.test(projectId)) throw new RepositoryError('not_found', `project ${projectId} not found`);
}

function itemWhere(projectId: string, f: ItemFilter): { text: string; params: unknown[] } {
  const params: unknown[] = [projectId];
  const conds = ['project_id = $1'];
  if (!f.includeDeleted) conds.push('deleted_at IS NULL');
  for (const [col, value] of [['node', f.node], ['type', f.type], ['decision', f.decision]] as const) {
    if (value === undefined) continue;
    params.push(value);
    conds.push(`${col} = $${params.length}`);
  }
  return { text: `SELECT * FROM items WHERE ${conds.join(' AND ')} ORDER BY seq`, params };
}

async function writeItems(tx: SqlExecutor, projectId: string, created: readonly Item[], changed: readonly Item[]) {
  if (created.length) await tx.query(SQL.insertItems, [projectId, JSON.stringify(created.map(itemToJson))]);
  if (changed.length) await tx.query(SQL.overwriteItems, [projectId, JSON.stringify(changed.map(itemToJson))]);
}

async function writeLinks(tx: SqlExecutor, projectId: string, added: readonly Link[], removed: readonly string[]) {
  if (removed.length) await tx.query(SQL.deleteLinks, [projectId, removed]);
  if (added.length) await tx.query(SQL.insertLinks, [projectId, JSON.stringify(added)]);
}

async function writeEvents(tx: SqlExecutor, projectId: string, events: readonly DecisionEvent[]) {
  if (events.length) await tx.query(SQL.insertEvents, [projectId, JSON.stringify(events)]);
}

async function writeRun(tx: SqlExecutor, run: Run) {
  await tx.query(SQL.insertRun, [
    run.projectId, run.id, run.task, run.node, run.provider, run.model, run.promptVersion,
    JSON.stringify(run.inputs), run.status, run.error ?? null, run.usage ? JSON.stringify(run.usage) : null,
    run.latencyMs, run.createdAt,
  ]);
}

async function applyRunPlan(tx: SqlExecutor, projectId: string, plan: RunPlan) {
  await writeRun(tx, plan.run);
  await writeItems(tx, projectId, plan.created, [...plan.updated, ...plan.retired]);
  await writeLinks(tx, projectId, plan.linksAdded, plan.linksRemoved);
  await writeEvents(tx, projectId, plan.events);
}

export class PgRepository implements Repository {
  private readonly q: SqlExecutor['query'];
  private readonly tx: Transaction;

  constructor(private readonly deps: PgRepositoryDeps = {}) {
    this.q = deps.query ?? poolQuery;
    this.tx = deps.withTransaction ?? poolTransaction;
  }

  private ctx(projectId: string): PlanContext {
    return { projectId, now: this.deps.now ? this.deps.now() : new Date().toISOString(), idSource: this.deps.idSource };
  }

  private items(rows: readonly ItemRow[]): Item[] {
    return mapRows(rows, rowToItem, (n) => this.deps.onInvalidRows?.('items', n));
  }

  private links(rows: readonly LinkRow[]): Link[] {
    return mapRows(rows, rowToLink, (n) => this.deps.onInvalidRows?.('links', n));
  }

  /** Locks the project row for the rest of the transaction; not_found if it does not exist. */
  private async lock(tx: SqlExecutor, projectId: string): Promise<void> {
    assertProjectId(projectId);
    const rows = await tx.query(SQL.lockProject, [projectId]);
    if (rows.length === 0) throw new RepositoryError('not_found', `project ${projectId} not found`);
  }

  private async state(tx: SqlExecutor, projectId: string): Promise<PlanState> {
    const items = this.items(await tx.query<ItemRow>(SQL.selectItems, [projectId]));
    const links = this.links(await tx.query<LinkRow>(SQL.selectLinks, [projectId]));
    return { items, links };
  }

  async getGraph(projectId: string): Promise<Graph> {
    assertProjectId(projectId);
    const [items, links] = await Promise.all([
      this.q<ItemRow>(SQL.selectLiveItems, [projectId]),
      this.q<LinkRow>(SQL.selectLinks, [projectId]),
    ]);
    return liveGraph(this.items(items), this.links(links));
  }

  async listItems(projectId: string, filter: ItemFilter = {}): Promise<Item[]> {
    assertProjectId(projectId);
    const { text, params } = itemWhere(projectId, filter);
    return this.items(await this.q<ItemRow>(text, params));
  }

  async saveRunOutput(projectId: string, output: RunOutputInput): Promise<SaveRunResult> {
    return this.tx(async (tx) => {
      await this.lock(tx, projectId);
      const plan = planRunOutput(await this.state(tx, projectId), output, this.ctx(projectId));
      await applyRunPlan(tx, projectId, plan);
      return toSaveRunResult(plan);
    });
  }

  async updateItem(projectId: string, itemId: string, patch: ItemPatch, event: EventMeta): Promise<Item> {
    return this.tx(async (tx) => {
      await this.lock(tx, projectId);
      const [item] = this.items(await tx.query<ItemRow>(SQL.selectItem, [projectId, itemId]));
      if (!item) throw new RepositoryError('not_found', `item ${itemId} not found`);
      const plan = planItemUpdate(item, patch, event, this.ctx(projectId));
      if (plan.events.length === 0) return plan.item;
      await writeItems(tx, projectId, [], [plan.item]);
      await writeEvents(tx, projectId, plan.events);
      return plan.item;
    });
  }

  async createItem(projectId: string, input: CreateItemInput): Promise<Item> {
    return this.tx(async (tx) => {
      await this.lock(tx, projectId);
      const plan = planCreateItem(await this.state(tx, projectId), input, this.ctx(projectId));
      await writeItems(tx, projectId, [plan.item], []);
      await writeLinks(tx, projectId, plan.links, []);
      await writeEvents(tx, projectId, plan.events);
      return plan.item;
    });
  }

  async refreshLinks(projectId: string, linkIds: readonly string[]): Promise<Link[]> {
    return this.tx(async (tx) => {
      await this.lock(tx, projectId);
      const refreshed = planRefreshLinks(await this.state(tx, projectId), linkIds);
      if (refreshed.length) await tx.query(SQL.refreshLinks, [projectId, JSON.stringify(refreshed)]);
      return refreshed;
    });
  }

  async listRuns(projectId: string, filter: RunFilter = {}): Promise<Run[]> {
    assertProjectId(projectId);
    const rows = await this.q<RunRow>(
      `SELECT * FROM runs WHERE project_id = $1 AND ($2::text IS NULL OR node = $2) AND ($3::text IS NULL OR task = $3)
       ORDER BY created_at DESC, seq DESC`,
      [projectId, filter.node ?? null, filter.task ?? null],
    );
    return mapRows(rows, rowToRun, (n) => this.deps.onInvalidRows?.('runs', n));
  }

  async listEvents(projectId: string, filter: EventFilter = {}): Promise<DecisionEvent[]> {
    assertProjectId(projectId);
    const rows = await this.q<EventRow>(
      'SELECT * FROM decision_events WHERE project_id = $1 AND ($2::text IS NULL OR item_id = $2) ORDER BY seq',
      [projectId, filter.itemId ?? null],
    );
    return mapRows(rows, rowToEvent, (n) => this.deps.onInvalidRows?.('decision_events', n));
  }
}
