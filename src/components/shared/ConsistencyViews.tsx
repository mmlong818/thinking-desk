'use client';

import Link from 'next/link';
import { getNode, type NodeKind } from '@/data/nodes';
import { useProject } from '@/components/project/ProjectStore';
import { useConsistency, type FindingItem } from '@/components/project/useConsistency';
import { SEVERITY_LABEL } from '@/lib/ai/schemas/consistency-check';
import { findingsOnNode, type RuleFinding } from '@/lib/model/consistency';
import { itemSummary } from '@/lib/model/feedback';
import type { Item } from '@/lib/model/item-types';
import { ITEM_TYPE_LABEL } from './item-labels';
import { JudgeStrip, judgedClass } from './JudgeStrip';

// Consistency findings as the person sees them: rule findings (deterministic, no AI) and the AI
// check's finding items, which are judged like any other item (accept = "real problem",
// reject with a note = "not a problem", fed back to the next check).

/** "08 设计案 · 功能「…」" linking to the item's node page. */
export function ItemRefLink({ item }: { item: Item }) {
  const { slug } = useProject();
  const node = getNode(item.node);
  return (
    <Link href={`/project/${slug}/${item.node}`} className="cons-ref" title={`${node?.num} ${node?.label}`}>
      <span className="cons-ref-node">{node?.num}</span>
      {ITEM_TYPE_LABEL[item.type]}「{itemSummary(item)}」
    </Link>
  );
}

export function RuleLine({ rule }: { rule: RuleFinding }) {
  return <div className={`cons-rule ${rule.severity}`}>{rule.message}</div>;
}

export function FindingCard({ finding }: { finding: FindingItem }) {
  const { involved } = useConsistency();
  const b = finding.body;
  return (
    <div className={`cons-finding sev-${b.severity} ${judgedClass(finding)}`}>
      <div className="cons-finding-head">
        <span className={`cons-sev ${b.severity}`}>{SEVERITY_LABEL[b.severity]}</span>
        <span className="cons-finding-title judged-text">{b.title}</span>
      </div>
      <div className="cons-finding-desc">{b.description}</div>
      <div className="cons-finding-fix"><b>建议：</b>{b.suggested_fix}</div>
      <div className="cons-finding-refs">
        {involved(finding).map((i) => <ItemRefLink key={i.id} item={i} />)}
      </div>
      <JudgeStrip item={finding} />
    </div>
  );
}

const MAX_INLINE = 4;

/** Non-blocking notice under a node's judge bar: rule findings and open AI findings touching the node. */
export function ConsistencyNotice({ node }: { node: NodeKind }) {
  const c = useConsistency();
  const rules = findingsOnNode(c.rules, node, c.byId);
  const open = c.findings.filter((f) => f.decision !== 'rejected' && (f.node === node || c.involved(f).some((i) => i.node === node)));
  if (rules.length === 0 && open.length === 0) return null;
  return (
    <div className="cons-notice" role="status">
      <span className="cons-notice-tag">一致性 · {rules.length + open.length}</span>
      <div className="cons-notice-list">
        {rules.slice(0, MAX_INLINE).map((r) => <RuleLine key={`${r.code}:${r.itemIds.join(',')}`} rule={r} />)}
        {open.slice(0, MAX_INLINE).map((f) => (
          <div key={f.id} className="cons-rule warn">AI：{f.body.title}{f.decision === 'accepted' ? '（你已确认）' : ''}</div>
        ))}
      </div>
      <span className="dim">
        {rules.length > MAX_INLINE || open.length > MAX_INLINE ? '…还有更多，' : ''}不阻塞流程 · 详情和 AI 检查见顶栏「一致性」
      </span>
    </div>
  );
}
