'use client';

import { useCallback, useMemo, useState } from 'react';
import type { NodeKind } from '@/data/nodes';
import type { ProjectRepository } from '@/lib/api/project-api';
import type { Item } from '@/lib/model/item-types';
import type { CreateItemInput, ItemPatch, LinkEdit, LinkEditResult } from '@/lib/model/repository';
import type { Evidence, Link } from '@/lib/model/types';
import { useProject } from './ProjectStore';

// Human-side writes on items: judge (accept / reject with a note / reset), edit the body,
// soft-delete, create, accept every recommendation of a node, confirm stale links ("still
// holds"), edit links by hand, store source checks. Each call reports its own error instead of
// throwing, so a control can show it next to itself.

export interface ItemActions {
  busy: string | null;
  error: string | null;
  clearError: () => void;
  accept: (item: Item) => Promise<Item | undefined>;
  reject: (item: Item, note?: string) => Promise<Item | undefined>;
  reset: (item: Item) => Promise<Item | undefined>;
  editBody: (item: Item, body: unknown) => Promise<Item | undefined>;
  remove: (item: Item) => Promise<Item | undefined>;
  create: (input: CreateItemInput) => Promise<Item | undefined>;
  acceptRecommended: (node: NodeKind) => Promise<Item[] | undefined>;
  confirmLinks: (linkIds: readonly string[], note?: string) => Promise<Link[] | undefined>;
  editLinks: (edit: LinkEdit, note?: string) => Promise<LinkEditResult | undefined>;
  setEvidence: (item: Item, evidence: Evidence, note?: string) => Promise<Item | undefined>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useItemActions(): ItemActions {
  const { write } = useProject();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async <T,>(key: string, fn: (repo: ProjectRepository, pid: string) => Promise<T>) => {
    setBusy(key);
    setError(null);
    try {
      return await write(fn);
    } catch (e) {
      setError(message(e));
      return undefined;
    } finally {
      setBusy(null);
    }
  }, [write]);

  const patch = useCallback(
    (item: Item, p: ItemPatch) => run(item.id, (repo, pid) => repo.updateItem(pid, item.id, p, { actor: 'human' })),
    [run],
  );

  return useMemo(() => ({
    busy,
    error,
    clearError: () => setError(null),
    accept: (item) => patch(item, { decision: 'accepted', decisionNote: null }),
    reject: (item, note) => patch(item, { decision: 'rejected', decisionNote: note?.trim() || null }),
    reset: (item) => patch(item, { decision: 'pending', decisionNote: null }),
    editBody: (item, body) => patch(item, { body }),
    remove: (item) => patch(item, { deleted: true }),
    create: (input) => run('create', (repo, pid) => repo.createItem(pid, input)),
    acceptRecommended: (node) => run('accept-recommended', (repo, pid) => repo.acceptRecommended(pid, node)),
    confirmLinks: (linkIds, note) =>
      run('confirm-links', (repo, pid) => repo.refreshLinks(pid, linkIds, { actor: 'human', ...(note ? { note } : {}) })),
    editLinks: (edit, note) => run('edit-links', (repo, pid) => repo.editLinks(pid, edit, { actor: 'human', ...(note ? { note } : {}) })),
    setEvidence: (item, evidence, note) =>
      run(item.id, (repo, pid) => repo.updateItem(pid, item.id, { evidence }, { actor: 'human', ...(note ? { note } : {}) })),
  }), [busy, error, patch, run]);
}
