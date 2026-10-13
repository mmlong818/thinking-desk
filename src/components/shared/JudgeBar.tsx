'use client';

import { getNode, type NodeKind } from '@/data/nodes';
import type { Item } from '@/lib/model/item-types';
import { useItemActions } from '@/components/project/useItemActions';
import { useNodeData } from '@/components/project/useNodeData';
import { ITEM_TYPE_LABEL } from './item-labels';
import { StaleNotice } from './StaleContent';

// Node-level judging aids: how many items wait for a decision, what completes the node,
// the one-click "accept every AI recommendation", and the non-blocking "missing" hints.

function completionText(kind: NodeKind, items: readonly Item[]): { done: boolean; text: string }[] {
  const accepted = items.filter((i) => i.node === kind && i.decision === 'accepted');
  return (getNode(kind)?.completion ?? []).map((clause) => {
    const n = accepted.filter((i) => clause.anyOf.includes(i.type)).length;
    const label = clause.anyOf.map((t) => ITEM_TYPE_LABEL[t]).join(' / ');
    return { done: n >= clause.min, text: `≥${clause.min} 条已采纳的${label}（${n}）` };
  });
}

export function AcceptRecommendedButton({ node }: { node: NodeKind }) {
  const { recommended } = useNodeData(node);
  const actions = useItemActions();
  const n = recommended.length;
  return (
    <span className="accept-rec">
      <button
        type="button"
        className="btn btn-ghost accept-rec-btn"
        disabled={n === 0 || actions.busy !== null}
        onClick={() => void actions.acceptRecommended(node)}
        title={n > 0 ? `一键采纳本节点 ${n} 条待定的 AI 推荐` : '本节点没有待定的 AI 推荐'}
      >
        ✓ 采纳全部推荐（{n}）
      </button>
      {actions.error ? <span className="idc-error">{actions.error}</span> : null}
    </span>
  );
}

export function NodeHints({ node }: { node: NodeKind }) {
  const { hints } = useNodeData(node);
  if (hints.length === 0) return null;
  return (
    <div className="node-hints" role="status">
      {hints.map((h) => (
        <div key={`${h.code}:${h.params?.category ?? ''}`} className="node-hint">
          <span className="node-hint-tag">提示</span>
          {h.message}
        </div>
      ))}
    </div>
  );
}

/** Counts, completion rule, accept-all and hints for the node's judgeable items. */
export function JudgeBar({ node, judged }: { node: NodeKind; judged?: readonly Item['type'][] }) {
  const { items, all, complete } = useNodeData(node);
  const scope = judged ? items.filter((i) => judged.includes(i.type)) : items;
  const count = (d: Item['decision']) => scope.filter((i) => i.decision === d).length;
  if (scope.length === 0) return null;
  return (
    <div className="para-section judge-bar-wrap">
      <div className={`judge-bar ${complete ? 'complete' : ''}`}>
        <span className="judge-counts">
          待定 <b>{count('pending')}</b> · 已采纳 <b>{count('accepted')}</b> · 已否决 <b>{count('rejected')}</b>
        </span>
        <span className="judge-completion">
          {complete ? '✓ 本节点已完成' : '完成条件：'}
          {complete ? null : completionText(node, all).map((c) => (
            <span key={c.text} className={`judge-clause ${c.done ? 'done' : ''}`}>{c.done ? '✓ ' : ''}{c.text}</span>
          ))}
        </span>
        <AcceptRecommendedButton node={node} />
      </div>
      <StaleNotice node={node} />
      <NodeHints node={node} />
    </div>
  );
}
