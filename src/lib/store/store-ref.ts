import type { ProjectRepository } from '../api/project-api';
import { LocalRepository } from '../model/local-repository';
import { HttpRepository } from './http-repository';

// Where a project's items live. The node page decides it the same way the app always decided
// whether a database exists: the project row was found in Postgres → 'pg' (projectId = the
// row's UUID, the browser talks to /api/projects/[id]/*); otherwise 'local' (projectId = the
// decoded slug, LocalRepository over localStorage).

export type StoreRef =
  | { mode: 'local'; projectId: string }
  | { mode: 'pg'; projectId: string };

export function createClientRepository(ref: StoreRef): ProjectRepository {
  if (ref.mode === 'pg') return new HttpRepository();
  return new LocalRepository({
    onCorrupt: (info) => {
      console.warn(`[local-store] dropped unreadable records of ${info.projectId}; original kept at ${info.backupKey}`, info.report);
    },
  });
}
