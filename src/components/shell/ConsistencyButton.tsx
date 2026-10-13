'use client';

import { useState } from 'react';
import { getNode, NODES, type NodeKind } from '@/data/nodes';
import { useConsistency, useConsistencyCheck, type FindingItem } from '@/components/project/useConsistency';
import { FindingCard, ItemRefLink, RuleLine } from '@/components/shared/ConsistencyViews';
import type { RuleFinding } from '@/lib/model/consistency';
import type { Item } from '@/lib/model/item-types';

// Project-level consistency panel (top bar): the rule findings of every node, and the AI check —
// started by hand only, one AI call — with its findings to accept or reject.

const DECISION_ORDER: Record<Item['decision'], number> = { pending: 0, accepted: 1, rejected: 2 };
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const;

function sortFindings(findings: FindingItem[]): FindingItem[] {
  return [...findings].sort((a, b) =>
    DECISION_ORDER[a.decision] - DECISION_ORDER[b.decision] || SEVERITY_ORDER[a.body.severity] - SEVERITY_ORDER[b.body.severity]);
}

function RulesSection({ rules, byId }: { rules: RuleFinding[]; byId: Map<string, Item> }) {
  const nodes = NODES.filter((n) => rules.some((r) => r.node === n.kind));
  return (
    <section className="cons-section">
      <h3>规则检查 <span className="dim">· 自动 · 不调用 AI · {rules.length} 条</span></h3>
      {rules.length === 0 ? <div className="dim">已采纳的条目之间没有发现结构性缺口。</div> : null}
      {nodes.map((n) => (
        <div key={n.kind} className="cons-node">
          <div className="cons-node-title">{n.num} {n.label}</div>
          <div className="cons-rule-list">
            {rules.filter((r) => r.node === n.kind).map((r) => (
              <div key={`${r.code}:${r.itemIds.join(',')}`}>
                <RuleLine rule={r} />
                <div className="cons-finding-refs">
                  {r.itemIds.map((id) => byId.get(id)).filter((i): i is Item => !!i).map((i) => <ItemRefLink key={i.id} item={i} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

function AiSection({ node }: { node: NodeKind }) {
  const c = useConsistency();
  const check = useConsistencyCheck(node);
  const last = c.lastRun;
  const pageNode = getNode(node);
  return (
    <section className="cons-section">
      <h3>AI 检查 <span className="dim">· 手动 · 找已采纳决定之间的语义矛盾</span></h3>
      <div className="cons-ai-bar">
        <button type="button" className="btn btn-accent btn-xs" onClick={check.run} disabled={check.running}>
          {check.running ? <><span className="ai-spinner" /> AI 检查中…（通常 30-90 秒）</> : '让 AI 检查跨节点矛盾（调用一次 AI）'}
        </button>
        {check.running ? <button type="button" className="btn btn-ghost btn-xs" onClick={check.cancel}>取消</button> : null}
        <span className="dim">
          {last ? `上次：${new Date(last.createdAt).toLocaleString('zh-CN')} · ${last.provider}:${last.model}` : `还没跑过 · 记录在 ${pageNode?.num} ${pageNode?.label}`}
        </span>
      </div>
      {check.error ? <div className="idc-error">{check.error}</div> : null}
      <div className="dim cons-ai-note">重跑会替换还没裁决的发现；你采纳 / 否决过的会保留，并告诉 AI 不要重复。每次检查找到的不一定相同，一次没报不代表没有矛盾，改动较大后可以再跑一次。</div>
      {c.findings.length === 0 && last ? <div className="dim">上次检查没有发现矛盾。</div> : null}
      {sortFindings(c.findings).map((f) => <FindingCard key={f.id} finding={f} />)}
    </section>
  );
}

export function ConsistencyButton({ node }: { node: NodeKind }) {
  const [open, setOpen] = useState(false);
  const c = useConsistency();
  const pending = c.findings.filter((f) => f.decision === 'pending').length;
  const count = c.rules.length + pending;
  return (
    <>
      <button className="btn btn-ghost" type="button" onClick={() => setOpen(true)} title="跨节点一致性：规则检查 + AI 检查">
        一致性{count > 0 ? <span className="cons-count">{count}</span> : null}
      </button>
      {open ? (
        <div className="cons-overlay" onClick={() => setOpen(false)}>
          <aside className="cons-drawer" onClick={(e) => e.stopPropagation()} aria-label="一致性检查">
            <div className="cons-drawer-head">
              <b>一致性检查</b>
              <span className="dim">只做提示，不阻塞任何节点</span>
              <button type="button" className="stale-close" onClick={() => setOpen(false)} aria-label="关闭">×</button>
            </div>
            <RulesSection rules={c.rules} byId={c.byId} />
            <AiSection node={node} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
