'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { addLocalProject, generateLocalSlug } from '@/lib/client-projects';
import { forkCache } from '@/lib/client-cache';

interface Props {
  fromSlug: string;
  fromName: string;
  currentNode: string;
}

/**
 * 分支当前项目 —— 并行探索另一条方向。
 * 复制本地 cache 的所有节点数据到新 slug，然后跳到新项目的当前节点。
 */
export function ForkButton({ fromSlug, fromName, currentNode }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  const onFork = async () => {
    if (busy) return;
    const suggested = `${fromName} · 分支`;
    const name = window.prompt('给分支起个名字', suggested)?.trim();
    if (!name) return;

    setBusy(true);
    try {
      const newSlug = generateLocalSlug(name);

      // 1) 复制所有节点 sessionStorage cache 到新 slug
      forkCache(fromSlug, newSlug);

      // 2) 本地登记
      addLocalProject({ slug: newSlug, name, summary: `分支自「${fromName}」` });

      // 3) DB 可达时也持久化条目（DB 不可达就跳过，不阻塞）
      try {
        await fetch('/api/projects', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name, summary: `分支自「${fromName}」` }),
        });
      } catch {
        // DB 不可达 — 仅本地分支
      }

      // 4) 跳转
      router.push(`/project/${newSlug}/${currentNode}`);
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
