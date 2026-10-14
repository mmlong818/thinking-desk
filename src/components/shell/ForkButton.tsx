'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { addLocalProject, generateLocalSlug, listLocalProjects } from '@/lib/client-projects';
import { completedNodes } from '@/lib/model/completion';
import { LocalRepository, localProjectId } from '@/lib/model/local-repository';
import { forkLocalProject } from '@/lib/model/local-transfer';
import { writeCompletionCookie } from '@/lib/store/completion-cookie';
import type { StoreRef } from '@/lib/store/store-ref';
import { copyUi } from '@/lib/store/ui-cache';

interface Props {
  fromName: string;
  currentNode: string;
  store: StoreRef;
}

/** Postgres: the server copies the project row and all its runs, items, links and events. */
async function forkInDb(store: StoreRef, name: string, summary: string): Promise<string> {
  const res = await fetch(`/api/projects/${encodeURIComponent(store.projectId)}/fork`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, summary }),
  });
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean; project?: { slug: string }; detail?: string; error?: string };
  if (!res.ok || !json.ok || !json.project) throw new Error(json.detail ?? json.error ?? `HTTP ${res.status}`);
  return json.project.slug;
}

/** Pure-local: copy the project document (and UI cache) under the new slug, then seed its completion cookie. */
async function forkLocally(store: StoreRef, name: string, summary: string): Promise<string> {
  const slug = generateLocalSlug(name);
  const toId = localProjectId(slug);
  forkLocalProject(window.localStorage, store.projectId, toId);
  copyUi(store.projectId, toId);
  const { items } = await new LocalRepository().getGraph(toId);
  writeCompletionCookie(slug, completedNodes(items));
  addLocalProject({ slug, name, summary });
  return slug;
}

/**
 * 分支当前项目 —— 并行探索另一条方向。
 * 复制当前项目的全部条目、链接、运行记录与裁决历史到新项目，然后跳到新项目的当前节点。
 */
export function ForkButton({ fromName, currentNode, store }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onFork = async () => {
    if (busy) return;
    const name = window.prompt('给分支起个名字', `${fromName} · 分支`)?.trim();
    if (!name) return;
    setBusy(true);
    try {
      // fromName is derived from the slug for local projects; the local index keeps the real name.
      const source = listLocalProjects().find((p) => localProjectId(p.slug) === store.projectId)?.name ?? fromName;
      const summary = `分支自「${source}」`;
      const slug = store.mode === 'pg' ? await forkInDb(store, name, summary) : await forkLocally(store, name, summary);
      router.push(`/project/${slug}/${currentNode}`);
    } catch (e) {
      window.alert(`分支失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className="nav-fork-btn"
      onClick={onFork}
      disabled={busy}
      title="基于当前项目分支一份 — 并行探索另一条方向"
    >
      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden>
        <circle cx="4" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="4" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.4" />
        <circle cx="12" cy="6" r="1.6" stroke="currentColor" strokeWidth="1.4" />
        <path d="M4 4.6v6.8M4.5 7.5c1.5 0 4-.5 6-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
      <span>{busy ? '分支中…' : '分支这一条'}</span>
    </button>
  );
}
