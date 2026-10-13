import { withTransaction as poolTransaction, type SqlExecutor } from './client';
import { toSlug, type ProjectRow } from './projects';
import { RepositoryError } from '../model/repository';

// Project branching in Postgres mode: a new project row plus a copy of every run, item, link
// and decision event. Ids are unique per project (composite keys), so rows copy as they are;
// ordering by seq keeps output and event order stable in the copy.

type Transaction = <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const FORK_SQL = {
  insertProject: `INSERT INTO projects (owner_id, name, slug, summary)
    SELECT owner_id, $2, $3, $4 FROM projects WHERE id = $1 RETURNING *`,
  copyRuns: `INSERT INTO runs (project_id, id, task, node, provider, model, prompt_version, inputs, status, error,
                    usage, latency_ms, created_at)
    SELECT $2, id, task, node, provider, model, prompt_version, inputs, status, error, usage, latency_ms, created_at
    FROM runs WHERE project_id = $1 ORDER BY seq`,
  copyItems: `INSERT INTO items (project_id, id, node, type, body, origin, decision, decision_note, ai_stance, evidence,
                     version, run_id, created_at, updated_at, deleted_at)
    SELECT $2, id, node, type, body, origin, decision, decision_note, ai_stance, evidence,
           version, run_id, created_at, updated_at, deleted_at
    FROM items WHERE project_id = $1 ORDER BY seq`,
  copyLinks: `INSERT INTO links (project_id, id, from_id, to_id, rel, to_version_seen, created_at)
    SELECT $2, id, from_id, to_id, rel, to_version_seen, created_at FROM links WHERE project_id = $1`,
  copyEvents: `INSERT INTO decision_events (project_id, id, item_id, kind, from_version, to_version, note, prev_body,
                               link, actor, at)
    SELECT $2, id, item_id, kind, from_version, to_version, note, prev_body, link, actor, at
    FROM decision_events WHERE project_id = $1 ORDER BY seq`,
} as const;

export interface ForkInput {
  name: string;
  summary?: string | null;
}

/** Copies project `fromId` into a new project (same owner) in one transaction. */
export async function forkProject(
  fromId: string,
  input: ForkInput,
  withTransaction: Transaction = poolTransaction,
): Promise<ProjectRow> {
  if (!UUID.test(fromId)) throw new RepositoryError('not_found', `project ${fromId} not found`);
  return withTransaction(async (tx) => {
    const [project] = await tx.query<ProjectRow>(FORK_SQL.insertProject, [
      fromId, input.name, toSlug(input.name), input.summary ?? null,
    ]);
    if (!project) throw new RepositoryError('not_found', `project ${fromId} not found`);
    for (const text of [FORK_SQL.copyRuns, FORK_SQL.copyItems, FORK_SQL.copyLinks, FORK_SQL.copyEvents]) {
      await tx.query(text, [fromId, project.id]);
    }
    return project;
  });
}
