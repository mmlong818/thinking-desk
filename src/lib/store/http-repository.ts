import type { NodeKind } from '../../data/nodes';
import type { ProjectRepository } from '../api/project-api';
import type { Graph } from '../model/graph';
import type { Item } from '../model/item-types';
import {
  RepositoryError,
  type CreateItemInput,
  type EventMeta,
  type ItemPatch,
  type RepositoryErrorCode,
  type RunFilter,
  type RunOutputInput,
  type SaveRunResult,
} from '../model/repository';
import type { Run } from '../model/types';

// Browser-side Repository for Postgres mode: the same calls LocalRepository answers, sent to
// /api/projects/[id]/*. Errors come back as RepositoryError with the server's code.

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const CODE_BY_STATUS: Record<number, RepositoryErrorCode> = { 400: 'invalid', 404: 'not_found', 409: 'conflict' };

interface ErrorBody {
  error?: string;
  detail?: string;
}

export class HttpRepository implements ProjectRepository {
  private readonly fetchImpl: FetchLike;

  constructor(fetchImpl?: FetchLike) {
    this.fetchImpl = fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  }

  private async call<T>(projectId: string, path: string, init?: { method: string; body: unknown }): Promise<T> {
    const url = `/api/projects/${encodeURIComponent(projectId)}/${path}`;
    const res = await this.fetchImpl(url, init
      ? { method: init.method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(init.body) }
      : undefined);
    const json = (await res.json().catch(() => ({}))) as T & ErrorBody & { ok?: boolean };
    if (!res.ok || !json.ok) {
      const code = CODE_BY_STATUS[res.status] ?? 'storage';
      throw new RepositoryError(code, json.detail ?? json.error ?? `HTTP ${res.status}`);
    }
    return json;
  }

  async getGraph(projectId: string): Promise<Graph> {
    return (await this.call<{ graph: Graph }>(projectId, 'graph')).graph;
  }

  async listRuns(projectId: string, filter: RunFilter = {}): Promise<Run[]> {
    const q = filter.node ? `?node=${encodeURIComponent(filter.node)}` : '';
    return (await this.call<{ runs: Run[] }>(projectId, `runs${q}`)).runs;
  }

  async saveRunOutput(projectId: string, output: RunOutputInput): Promise<SaveRunResult> {
    return (await this.call<{ result: SaveRunResult }>(projectId, 'runs', { method: 'POST', body: output })).result;
  }

  async updateItem(projectId: string, itemId: string, patch: ItemPatch, event: EventMeta): Promise<Item> {
    const body = { patch, ...(event.note ? { note: event.note } : {}) };
    const path = `items/${encodeURIComponent(itemId)}`;
    return (await this.call<{ item: Item }>(projectId, path, { method: 'PATCH', body })).item;
  }

  async createItem(projectId: string, input: CreateItemInput): Promise<Item> {
    return (await this.call<{ item: Item }>(projectId, 'items', { method: 'POST', body: input })).item;
  }

  async acceptRecommended(projectId: string, node: NodeKind, meta: { note?: string } = {}): Promise<Item[]> {
    const body = { node, ...(meta.note ? { note: meta.note } : {}) };
    return (await this.call<{ items: Item[] }>(projectId, 'accept-recommended', { method: 'POST', body })).items;
  }
}
