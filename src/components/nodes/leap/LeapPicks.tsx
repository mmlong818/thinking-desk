'use client';

import type { ItemOfType } from '@/lib/model/context';
import { ParaHead } from '@/components/shared/NodeKit';
import { leapTitle, METHOD_LABEL, PICK_CLASS, PICK_LABEL, TIMING_META, type LeapItem } from './leap-meta';

export function TimingCard({ timing }: { timing: ItemOfType<'summary'> }) {
  const meta = TIMING_META[timing.body.verdict ?? 'selective'];
  return (
    <div className={`leap-timing verdict-${meta.cls}`}>
      <div className="leap-timing-label">胆量级别</div>
      <div className="leap-timing-title">{meta.label}</div>
      <div className="leap-timing-reason">{timing.body.text}</div>
      <div className="leap-timing-hint">{meta.hint}</div>
    </div>
  );
}

/** "你采纳的跃迁" (the person's picks) and "AI 推荐采纳" (the AI's top picks, with the changes they imply). */
export function UserPicksSection({ leaps }: { leaps: LeapItem[] }) {
  const picked = leaps.filter((l) => l.decision === 'accepted');
  const recommended = leaps.filter((l) => l.aiStance?.verdict === 'recommend');
  if (picked.length === 0 && recommended.length === 0) return null;
  return (
    <>
      {picked.length > 0 ? (
        <div className="para-section">
          <ParaHead title="你采纳的跃迁" hint={`${picked.length} 条 · 带入后续节点`} />
          <div className="user-picks">
            {picked.map((l) => (
              <div key={l.id} className={`user-pick method-${PICK_CLASS[l.type]}`}>
                <span className={`user-pick-method pick-${PICK_CLASS[l.type]}`}>{PICK_LABEL[l.type]}</span>
                <span className="user-pick-title">{leapTitle(l)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {recommended.length > 0 ? (
        <div className="para-section">
          <ParaHead title="AI 推荐采纳" hint={`${recommended.length} 条 · 可作参考`} />
          <div className="top-picks">
            {recommended.map((l, i) => <TopPick key={l.id} item={l} index={i} />)}
          </div>
        </div>
      ) : null}
    </>
  );
}

function TopPick({ item, index }: { item: LeapItem; index: number }) {
  const changes = item.body.required_changes ?? [];
  return (
    <div className="pick-card">
      <div className="pick-head">
        <span className="pick-num">#{index + 1}</span>
        <span className="pick-method">{METHOD_LABEL[item.type]}</span>
        <span className={`decision-badge ${item.decision}`}>{item.decision === 'accepted' ? '已采纳' : item.decision === 'rejected' ? '已否决' : '待定'}</span>
      </div>
      <div className="pick-why">{item.aiStance?.reason}</div>
      {changes.length > 0 ? (
        <div className="pick-changes">
          <div className="pick-changes-label">若采纳，功能列表要改：</div>
          <ul>{changes.map((c, j) => <li key={j}>{c}</li>)}</ul>
        </div>
      ) : null}
    </div>
  );
}
