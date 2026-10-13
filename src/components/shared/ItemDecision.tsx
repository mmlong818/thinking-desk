'use client';

import { useState } from 'react';
import type { Item } from '@/lib/model/item-types';
import type { AiStance, Decision, Evidence } from '@/lib/model/types';
import { useItemActions } from '@/components/project/useItemActions';

// The human judgment on one item: accept / reject with an optional note (fed back to the AI
// on the next regeneration) / undo, plus an optional edit toggle. Badges show the AI's own
// stance with its reason and any evidence, so the person judges with the AI's view in sight.

const STANCE_LABEL: Record<AiStance['verdict'], string> = { recommend: 'AI 推荐', neutral: 'AI 中立', caution: 'AI 提醒谨慎' };
const DECISION_LABEL: Record<Decision, string> = { pending: '待定', accepted: '已采纳', rejected: '已否决' };
const BASIS_LABEL: Record<Evidence['basis'], string> = { web: '联网检索', model_knowledge: '模型知识', user_input: '用户输入' };

export function StanceBadge({ stance, withReason = false }: { stance?: AiStance; withReason?: boolean }) {
  if (!stance) return null;
  return (
    <span className={`ai-stance ${stance.verdict}`} title={stance.reason}>
      {STANCE_LABEL[stance.verdict]}
      {withReason && stance.reason ? <span className="ai-stance-reason"> · {stance.reason}</span> : null}
    </span>
  );
}

export function DecisionBadge({ item }: { item: Item }) {
  const origin = item.origin === 'ai_edited' ? ' · 已改' : item.origin === 'human' ? ' · 手动' : '';
  return <span className={`decision-badge ${item.decision}`}>{DECISION_LABEL[item.decision]}{origin}</span>;
}

export function EvidenceLine({ evidence }: { evidence?: Evidence }) {
  if (!evidence) return null;
  return (
    <div className="evidence-line">
      依据：{BASIS_LABEL[evidence.basis]} · 置信度 {Math.round(evidence.confidence * 100)}%
      {evidence.sources.map((s, i) =>
        s.url ? (
          <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" className="evidence-source">
            {s.title || `来源 ${i + 1}`}{s.verified ? ' ✓' : ''}
          </a>
        ) : (
          <span key={i} className="evidence-source">{s.title}</span>
        ),
      )}
    </div>
  );
}

interface DecisionProps {
  item: Item;
  /** 'full' adds button labels, the decision badge and the stance reason. */
  variant?: 'compact' | 'full';
  /** Return a message to block accepting (e.g. "最多深入 3 个情景"). */
  guardAccept?: () => string | null;
  /** Set to explain why this item cannot be rejected (e.g. baseline stakeholders). */
  rejectBlocked?: string;
  /** Shows a ✎ toggle when given. */
  onToggleEdit?: () => void;
  editing?: boolean;
  /** False when the card shows the rejection note itself (cramped headers). */
  showNote?: boolean;
}

export function ItemDecision({
  item, variant = 'compact', guardAccept, rejectBlocked, onToggleEdit, editing, showNote = true,
}: DecisionProps) {
  const actions = useItemActions();
  const [noting, setNoting] = useState(false);
  const [guardError, setGuardError] = useState<string | null>(null);
  const full = variant === 'full';
  const busy = actions.busy !== null;

  const onAccept = () => {
    if (item.decision === 'accepted') return void actions.reset(item);
    const blocked = guardAccept?.() ?? null;
    setGuardError(blocked);
    if (!blocked) void actions.accept(item);
  };
  const onReject = () => (item.decision === 'rejected' ? void actions.reset(item) : setNoting(true));

  return (
    <div className={`item-decision ${variant} state-${item.decision}`}>
      <div className="idc-row">
        {full ? <DecisionBadge item={item} /> : null}
        <DecisionButton kind="accept" on={item.decision === 'accepted'} full={full} disabled={busy} onClick={onAccept} />
        <DecisionButton
          kind="reject" on={item.decision === 'rejected'} full={full} disabled={busy || (!!rejectBlocked && item.decision !== 'rejected')}
          onClick={onReject} titleOverride={rejectBlocked}
        />
        {onToggleEdit ? (
          <button type="button" className={`idc-btn edit ${editing ? 'on' : ''}`} onClick={onToggleEdit} title="编辑这一条" aria-pressed={editing}>
            ✎{full ? ' 编辑' : ''}
          </button>
        ) : null}
        {full ? <StanceBadge stance={item.aiStance} withReason /> : null}
      </div>
      {noting ? (
        <RejectNote
          onCancel={() => setNoting(false)}
          onConfirm={(note) => {
            setNoting(false);
            void actions.reject(item, note);
          }}
        />
      ) : null}
      {showNote ? <RejectionNote item={item} /> : null}
      {guardError || actions.error ? <div className="idc-error">{guardError ?? actions.error}</div> : null}
    </div>
  );
}

/** "否决理由：…" under a rejected item. */
export function RejectionNote({ item }: { item: Item }) {
  if (item.decision !== 'rejected' || !item.decisionNote) return null;
  return <div className="idc-note">否决理由：{item.decisionNote}</div>;
}

function DecisionButton({ kind, on, full, disabled, onClick, titleOverride }: {
  kind: 'accept' | 'reject';
  on: boolean;
  full: boolean;
  disabled: boolean;
  onClick: () => void;
  titleOverride?: string;
}) {
  const accept = kind === 'accept';
  const title = titleOverride
    ?? (accept ? (on ? '撤销采纳（回到待定）' : '采纳这一条') : on ? '撤销否决（回到待定）' : '否决这一条（可写理由，AI 下次会避开）');
  return (
    <button type="button" className={`idc-btn ${kind} ${on ? 'on' : ''}`} onClick={onClick} disabled={disabled} title={title} aria-pressed={on}>
      {accept ? '✓' : '✗'}
      {full ? (accept ? (on ? ' 已采纳' : ' 采纳') : on ? ' 已否决' : ' 否决') : ''}
    </button>
  );
}

function RejectNote({ onConfirm, onCancel }: { onConfirm: (note: string) => void; onCancel: () => void }) {
  const [note, setNote] = useState('');
  return (
    <div className="idc-reject">
      <input
        autoFocus
        className="idc-reject-input"
        value={note}
        placeholder="否决理由（可选 · 重新生成时会告诉 AI 避开）"
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) onConfirm(note);
          if (e.key === 'Escape') onCancel();
        }}
      />
      <button type="button" className="btn btn-ghost btn-xs" onClick={onCancel}>取消</button>
      <button type="button" className="btn btn-accent btn-xs" onClick={() => onConfirm(note)}>确认否决</button>
    </div>
  );
}
