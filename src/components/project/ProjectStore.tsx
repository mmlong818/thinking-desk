'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { NodeKind } from '@/data/nodes';
import type { ProjectRepository } from '@/lib/api/project-api';
import { completedNodes, completionCookieValue } from '@/lib/model/completion';
import type { Item } from '@/lib/model/item-types';
import type { Link, Run } from '@/lib/model/types';
import { writeCompletionCookie } from '@/lib/store/completion-cookie';
import { createClientRepository, type StoreRef } from '@/lib/store/store-ref';

// One project's items, links and runs for the node page, read from the repository the page
// picked (LocalRepository or the HTTP client for Postgres). Every write goes through `write`,
// which reloads afterwards, re-derives node completion, mirrors it into the td-done cookie
// (pure-local mode) and refreshes the server-rendered nav / lock state when it changed.

export interface ProjectSnapshot {
  items: Item[];
  links: Link[];
  runs: Run[];
}

export interface ProjectStoreValue {
  store: StoreRef;
  slug: string;
  repo: ProjectRepository;
  /** Null until the first load finishes. */
  snapshot: ProjectSnapshot | null;
  loadError: string | null;
  reload: () => Promise<void>;
  /** Runs one repository write, then reloads. Errors propagate to the caller. */
  write: <T>(fn: (repo: ProjectRepository, projectId: string) => Promise<T>) => Promise<T>;
}

const ProjectStoreContext = createContext<ProjectStoreValue | null>(null);

interface Props {
  store: StoreRef;
  slug: string;
  /** Postgres mode: the items, links and runs the server already loaded (first paint without a round trip). */
  initial?: ProjectSnapshot | null;
  /** Completion the server rendered the nav / locks with. */
  completed: readonly NodeKind[];
  children: ReactNode;
}

function useCompletionSync(store: StoreRef, slug: string, completed: readonly NodeKind[]) {
  const router = useRouter();
  const lastRef = useRef(completionCookieValue(new Set(completed)));
  return useCallback((items: readonly Item[]) => {
    const done = completedNodes(items);
    if (store.mode === 'local') writeCompletionCookie(slug, done);
    const value = completionCookieValue(done);
    if (value === lastRef.current) return;
    lastRef.current = value;
    router.refresh();
  }, [store.mode, slug, router]);
}

export function ProjectStoreProvider({ store, slug, initial, completed, children }: Props) {
  const { mode, projectId } = store;
  const repo = useMemo(() => createClientRepository({ mode, projectId }), [mode, projectId]);
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(initial ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const sync = useCompletionSync(store, slug, completed);

  const reload = useCallback(async () => {
    try {
      const [graph, runs] = await Promise.all([repo.getGraph(projectId), repo.listRuns(projectId)]);
      setSnapshot({ ...graph, runs });
      setLoadError(null);
      sync(graph.items);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    }
  }, [repo, projectId, sync]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const write = useCallback(async <T,>(fn: (r: ProjectRepository, id: string) => Promise<T>): Promise<T> => {
    try {
      return await fn(repo, projectId);
    } finally {
      await reload();
    }
  }, [repo, projectId, reload]);

  const value = useMemo<ProjectStoreValue>(
    () => ({ store, slug, repo, snapshot, loadError, reload, write }),
    [store, slug, repo, snapshot, loadError, reload, write],
  );
  return <ProjectStoreContext.Provider value={value}>{children}</ProjectStoreContext.Provider>;
}

export function useProject(): ProjectStoreValue {
  const ctx = useContext(ProjectStoreContext);
  if (!ctx) throw new Error('useProject() needs a <ProjectStoreProvider>');
  return ctx;
}
