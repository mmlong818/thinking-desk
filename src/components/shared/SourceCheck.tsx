'use client';

import { useState } from 'react';
import type { NodeKind } from '@/data/nodes';
import { useProject } from '@/components/project/ProjectStore';
import { useNodeData } from '@/components/project/useNodeData';
import type { EvidenceSource } from '@/lib/model/types';
import { checkSourceUrls, sourceJobs, withResults } from '@/lib/store/source-check';

// Source checks as the person sees them: a label per cited URL ("已核实 / 未核实 / 无法打开") and,
// on nodes whose items cite URLs, one button that checks them all on the server (reachable? page
// title matches?) and stores the result on each item's evidence.

type Label = { text: string; cls: string };

export function sourceLabel(s: EvidenceSource): Label {
  switch (s.status) {
    case 'title_match': return { text: '已核实', cls: 'ok' };
    case 'reachable': return { text: '未核实 · 可打开', cls: 'open' };
    case 'unreachable': return { text: '无法打开', cls: 'bad' };
    case 'blocked': return { text: '无法打开 · 已拦截', cls: 'bad' };
    default: return { text: '未核实', cls: 'none' };
  }
}

export function sourceTitle(s: EvidenceSource): string {
  const parts = [
    s.pageTitle ? `页面标题：${s.pageTitle}` : '',
    s.detail ? `原因：${s.detail}` : '',
    s.checkedAt ? `核实于 ${new Date(s.checkedAt).toLocaleString('zh-CN')}` : '还没有核实过',
  ];
  return parts.filter(Boolean).join('\n');
}

export function SourceBadge({ source }: { source: EvidenceSource }) {
  const label = sourceLabel(source);
  return <span className={`source-badge ${label.cls}`} title={sourceTitle(source)}>{label.text}</span>;
}

function useNodeSourceCheck(node: NodeKind) {
  const { write } = useProject();
  const { items } = useNodeData(node);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const jobs = sourceJobs(items);
  const run = async () => {
    setRunning(true);
    setMessage(null);
    try {
      const results = await checkSourceUrls((u, i) => fetch(u, i), jobs.flatMap((j) => j.requests));
      const now = new Date().toISOString();
      await write(async (repo, pid) => {
        let offset = 0;
        for (const job of jobs) {
          const mine = results.slice(offset, offset + job.requests.length);
          offset += job.requests.length;
          await repo.updateItem(pid, job.item.id, { evidence: withResults(job.evidence, mine, now) }, { actor: 'human', note: '核实来源' });
        }
      });
      const ok = results.filter((r) => r.verified).length;
      setMessage(`核实了 ${results.length} 个链接：${ok} 个标题吻合`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };
  return { jobs, run, running, message };
}

/** "核实本节点来源（N 个链接）" — only on nodes whose items cite URLs. */
export function SourceCheckBar({ node }: { node: NodeKind }) {
  const { jobs, run, running, message } = useNodeSourceCheck(node);
  const urls = jobs.reduce((n, j) => n + j.requests.length, 0);
  if (urls === 0) return null;
  const counts = { ok: 0, bad: 0, other: 0 };
  for (const j of jobs) {
    for (const s of j.evidence.sources.filter((x) => x.url)) {
      const cls = sourceLabel(s).cls;
      counts[cls === 'ok' ? 'ok' : cls === 'bad' ? 'bad' : 'other'] += 1;
    }
  }
  return (
    <div className="source-bar">
      <span>来源链接 {urls} 个：已核实 {counts.ok} · 未核实 {counts.other} · 无法打开 {counts.bad}</span>
      <button type="button" className="btn btn-ghost btn-xs" disabled={running} onClick={() => void run()}
        title="由服务端逐个打开链接，看能否访问、页面标题是否与引用对得上（不调用 AI）">
        {running ? <><span className="ai-spinner" /> 核实中…</> : `核实本节点来源（${urls} 个链接）`}
      </button>
      {message ? <span className="dim">{message}</span> : null}
    </div>
  );
}
