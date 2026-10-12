'use client';

import { useState } from 'react';
import { listLocalProjects } from '@/lib/client-projects';
import { createClientRepository, type StoreRef } from '@/lib/store/store-ref';
import { toGraphExport, toMarkdown } from './export-format';

interface Props {
  projectSlug: string;
  projectName: string;
  store: StoreRef;
}

type Fmt = 'md' | 'json';

function realNameOf(projectSlug: string, fallback: string): string {
  try {
    const decoded = decodeURIComponent(projectSlug);
    return listLocalProjects().find((p) => p.slug === projectSlug || p.slug === decoded)?.name ?? fallback;
  } catch {
    return fallback;
  }
}

function download(text: string, fileName: string, mime: string) {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function ExportButton({ projectSlug, projectName, store }: Props) {
  const [open, setOpen] = useState(false);

  const exportNow = async (fmt: Fmt) => {
    setOpen(false);
    const name = realNameOf(projectSlug, projectName);
    let graph;
    try {
      graph = await createClientRepository(store).getGraph(store.projectId);
    } catch (e) {
      alert(`读取项目数据失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (graph.items.length === 0) {
      alert('当前项目还没有任何节点产出，先跑几个节点再导出。');
      return;
    }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    if (fmt === 'json') {
      download(JSON.stringify(toGraphExport(name, graph), null, 2), `${name}-${stamp}.json`, 'application/json');
    } else {
      download(toMarkdown(name, graph.items), `${name}-${stamp}.md`, 'text/markdown');
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ghost" type="button" onClick={() => setOpen((v) => !v)}>导出</button>
      {open ? (
        <div className="export-menu" onMouseLeave={() => setOpen(false)}>
          <button className="export-menu-item" onClick={() => void exportNow('md')}>
            <b>Markdown</b>
            <span className="dim">一份汇总文档 · 适合阅读 / 复制</span>
          </button>
          <button className="export-menu-item" onClick={() => void exportNow('json')}>
            <b>JSON</b>
            <span className="dim">完整结构化数据 · 适合二次处理</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
