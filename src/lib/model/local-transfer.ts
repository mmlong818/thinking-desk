import { decodeDoc, type DecodeReport, type ProjectDoc } from './local-doc';
import { localBackupKey, localProjectKey, type StorageLike } from './local-repository';
import { RepositoryError } from './repository';

// Copying a pure-local project: branching (`td:v2:<from>` → `td:v2:<to>`) and importing an
// exported graph. Every record carries its projectId, so a copy rewrites it; ids stay as they
// are (they are unique per project), which keeps links, runs and events consistent.

function withProjectId<T extends { projectId: string }>(records: readonly T[], projectId: string): T[] {
  return records.map((r) => ({ ...r, projectId }));
}

/** The same project content under another projectId. */
export function rebaseDoc(doc: ProjectDoc, projectId: string): ProjectDoc {
  return {
    ...doc,
    items: withProjectId(doc.items, projectId),
    links: withProjectId(doc.links, projectId),
    runs: withProjectId(doc.runs, projectId),
    events: withProjectId(doc.events, projectId),
  };
}

function assertEmpty(storage: StorageLike, projectId: string): void {
  if (storage.getItem(localProjectKey(projectId)) !== null) {
    throw new RepositoryError('conflict', `project ${projectId} already has local data`);
  }
}

/** Branches a local project. Returns false when the source has no data yet (nothing to copy). */
export function forkLocalProject(storage: StorageLike, fromId: string, toId: string): boolean {
  const raw = storage.getItem(localProjectKey(fromId));
  if (raw === null) return false;
  assertEmpty(storage, toId);
  const { doc } = decodeDoc(raw, fromId);
  storage.setItem(localProjectKey(toId), JSON.stringify(rebaseDoc(doc, toId)));
  return true;
}

export interface ImportedGraph {
  items: unknown[];
  links: unknown[];
  runs?: unknown[];
  events?: unknown[];
}

function rebaseRaw(records: unknown[] | undefined, projectId: string): unknown[] {
  return (records ?? []).map((r) => (typeof r === 'object' && r !== null ? { ...r, projectId } : r));
}

/**
 * Writes an exported graph as a new local project. Records are validated like any stored
 * value; invalid ones are dropped and reported, so a partially broken file still imports.
 */
export function importLocalProject(storage: StorageLike, projectId: string, graph: ImportedGraph): DecodeReport {
  assertEmpty(storage, projectId);
  const raw = JSON.stringify({
    v: 1,
    items: rebaseRaw(graph.items, projectId),
    links: rebaseRaw(graph.links, projectId),
    runs: rebaseRaw(graph.runs, projectId),
    events: rebaseRaw(graph.events, projectId),
  });
  const { doc, report } = decodeDoc(raw, projectId);
  storage.setItem(localProjectKey(projectId), JSON.stringify(doc));
  return report;
}

/** Removes a local project's data and its corruption backup. */
export function removeLocalProjectData(storage: StorageLike & { removeItem(key: string): void }, projectId: string): void {
  storage.removeItem(localProjectKey(projectId));
  storage.removeItem(localBackupKey(projectId));
}

