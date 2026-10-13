import { z } from 'zod';
import { withTransaction as poolTransaction, type SqlExecutor } from './client';
import { RepositoryError } from '../model/repository';

// Deleting a project in Postgres mode: lock the project row, then remove its decision events,
// links, items and runs and finally the row itself, in one transaction and in FK-safe order
// (the ON DELETE CASCADEs would remove most of it too; explicit deletes keep the order and the
// counts visible). Pure-local projects are deleted in the browser (purgeProjectClientData).

type Transaction = <T>(fn: (tx: SqlExecutor) => Promise<T>) => Promise<T>;

/** Project ids are database UUIDs (any version; the demo owner id is not RFC 4122). */
export const ProjectIdSchema = z.guid();

const count = (table: string) =>
  `WITH d AS (DELETE FROM ${table} WHERE project_id = $1 RETURNING 1) SELECT count(*)::int AS n FROM d`;

export const DELETE_SQL = {
  lockProject: 'SELECT id FROM projects WHERE id = $1 FOR UPDATE',
  deleteEvents: count('decision_events'),
  deleteLinks: count('links'),
  deleteItems: count('items'),
  deleteRuns: count('runs'),
  deleteProject: 'DELETE FROM projects WHERE id = $1',
} as const;

export interface DeletedCounts {
  events: number;
  links: number;
  items: number;
  runs: number;
}

/** Deletes project `id` and everything in it; RepositoryError not_found when there is no such project. */
export async function deleteProject(id: string, withTransaction: Transaction = poolTransaction): Promise<DeletedCounts> {
  if (!ProjectIdSchema.safeParse(id).success) throw new RepositoryError('not_found', `project ${id} not found`);
  return withTransaction(async (tx) => {
    const [project] = await tx.query(DELETE_SQL.lockProject, [id]);
    if (!project) throw new RepositoryError('not_found', `project ${id} not found`);
    const n = async (text: string) => (await tx.query<{ n: number }>(text, [id]))[0]?.n ?? 0;
    const deleted = {
      events: await n(DELETE_SQL.deleteEvents),
      links: await n(DELETE_SQL.deleteLinks),
      items: await n(DELETE_SQL.deleteItems),
      runs: await n(DELETE_SQL.deleteRuns),
    };
    await tx.query(DELETE_SQL.deleteProject, [id]);
    return deleted;
  });
}
