'use client';

import { useState } from 'react';
import { listLocalProjects } from '@/lib/client-projects';
import { toPrdMarkdown } from '@/lib/export/prd';
import { taskRows, toGithubIssues, toJiraCsv, toLinearCsv } from '@/lib/export/tasks';
import type { Graph } from '@/lib/model/graph';
import { createClientRepository, type StoreRef } from '@/lib/store/store-ref';
import { toGraphExport, toMarkdown } from './export-format';

// Downloads only: every format is built in the browser from the project's items and saved as a
// file; nothing is sent to an external service. Import steps per tool: docs/exports.md.

interface Props {
  projectSlug: string;
  projectName: string;
  store: StoreRef;
}

interface FileOut {
  text: string;
  suffix: string;
  mime: string;
}

interface ExportDef {
  label: string;
  hint: string;
  /** A file, or a message saying why there is nothing to export. */
  build: (name: string, graph: Graph) => FileOut | string;
}

const NO_TASKS = '还没有已采纳的子任务：先在 09 子功能拆分里采纳子任务再导出任务单。';

const tasksOr = (graph: Graph, build: (rows: ReturnType<typeof taskRows>) => FileOut): FileOut | string => {
  const rows = taskRows(graph);
  return rows.length > 0 ? build(rows) : NO_TASKS;
};

const EXPORTS: Array<[string, ExportDef]> = [
  ['md', { label: 'Markdown', hint: '全部节点的汇总 · 含待定与否决', build: (name, g) => ({ text: toMarkdown(name, g.items), suffix: '.md', mime: 'text/markdown' }) }],
  ['json', { label: 'JSON', hint: '完整结构化数据 · 可再导入', build: (name, g) => ({ text: JSON.stringify(toGraphExport(name, g), null, 2), suffix: '.json', mime: 'application/json' }) }],
  ['prd', { label: 'PRD（Markdown）', hint: '只含已采纳的内容 · 标注来源与 AI 立场', build: (name, g) => ({ text: toPrdMarkdown(name, g), suffix: '-PRD.md', mime: 'text/markdown' }) }],
  ['jira', { label: '任务单 · Jira CSV', hint: '已采纳的子任务 · Jira「从 CSV 导入」', build: (_n, g) => tasksOr(g, (rows) => ({ text: toJiraCsv(rows), suffix: '-jira.csv', mime: 'text/csv' })) }],
  ['linear', { label: '任务单 · Linear CSV', hint: '用 @linear/import 的 Linear CSV 导入', build: (_n, g) => tasksOr(g, (rows) => ({ text: toLinearCsv(rows), suffix: '-linear.csv', mime: 'text/csv' })) }],
  ['github', { label: '任务单 · GitHub Issues', hint: 'JSON · 用 gh 命令批量建 issue', build: (_n, g) => tasksOr(g, (rows) => ({ text: JSON.stringify(toGithubIssues(rows), null, 2), suffix: '-github-issues.json', mime: 'application/json' })) }],
];

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

  const exportNow = async (def: ExportDef) => {
    setOpen(false);
    const name = realNameOf(projectSlug, projectName);
    let graph: Graph;
    try {
      graph = await createClientRepository(store).getGraph(store.projectId);
    } catch (e) {
      alert(`读取项目数据失败：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    if (graph.items.length === 0) return alert('当前项目还没有任何节点产出，先跑几个节点再导出。');
    const out = def.build(name, graph);
    if (typeof out === 'string') return alert(out);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    download(out.text, `${name}-${stamp}${out.suffix}`, out.mime);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ghost" type="button" onClick={() => setOpen((v) => !v)}>导出</button>
      {open ? (
        <div className="export-menu" onMouseLeave={() => setOpen(false)}>
          {EXPORTS.map(([key, def]) => (
            <button key={key} className="export-menu-item" onClick={() => void exportNow(def)}>
              <b>{def.label}</b>
              <span className="dim">{def.hint}</span>
            </button>
          ))}
          <div className="export-menu-note">只生成文件，不会推送到任何外部服务 · 导入方法见 docs/exports.md</div>
        </div>
      ) : null}
    </div>
  );
}
