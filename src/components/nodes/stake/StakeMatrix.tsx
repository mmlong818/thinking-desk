'use client';

import { useState } from 'react';
import type { EngagementPlan } from '@/lib/ai/schemas/analyze-stakeholders';
import type { ItemOfType } from '@/lib/model/context';
import { useItemActions } from '@/components/project/useItemActions';
import { EditableItemFields } from '@/components/shared/EditableItemFields';
import { ItemDecision, StanceBadge } from '@/components/shared/ItemDecision';
import {
  CATEGORY_LABEL, groupByQuadrant, QUADRANT_META, quadrantOf, REQUIRED_REJECT_BLOCKED,
  type Quadrant, type StakeItem,
} from './stake-meta';

export function MendelowMatrix({ stakeholders }: { stakeholders: StakeItem[] }) {
  const grouped = groupByQuadrant(stakeholders);
  return (
    <div className="mendelow">
      <div className="mendelow-y-label">
        <span>高</span>
        <span>← 权力 →</span>
        <span>低</span>
      </div>
      <div className="mendelow-grid">
        {(['satisfy', 'manage', 'monitor', 'inform'] as const).map((q) => <Cell key={q} quadrant={q} items={grouped[q]} />)}
      </div>
      <div className="mendelow-x-label">
        <span>低</span>
        <span>关心程度 →</span>
        <span>高</span>
      </div>
    </div>
  );
}

function Cell({ quadrant, items }: { quadrant: Quadrant; items: StakeItem[] }) {
  const meta = QUADRANT_META[quadrant];
  return (
    <div className={`mendelow-cell q-${quadrant}`}>
      <div className="mendelow-cell-head">
        <span className="mendelow-cell-title">{meta.title}</span>
        <span className="mendelow-cell-sub">{meta.subtitle}</span>
      </div>
      <div className="mendelow-cell-hint">{meta.hint}</div>
      <div className="mendelow-cell-items">
        {items.length === 0 ? (
          <div className="mendelow-cell-empty">（此象限暂无）</div>
        ) : (
          items.map((s) => <StakeholderChip key={s.id} item={s} />)
        )}
      </div>
    </div>
  );
}

const CHIP_MARK = { accepted: '✓', pending: '○', rejected: '✗' } as const;

/** Click = accept / back to pending; × = reject (the list below takes a note). */
function StakeholderChip({ item }: { item: StakeItem }) {
  const actions = useItemActions();
  const s = item.body;
  const accepted = item.decision === 'accepted';
  return (
    <div
      className={`stake-chip ${accepted ? 'selected' : ''} ${s.required ? 'required' : ''} ${item.decision === 'rejected' ? 'is-rejected' : ''}`}
      title={s.note}
    >
      <button
        type="button"
        className="stake-chip-main"
        onClick={() => void (accepted ? actions.reset(item) : actions.accept(item))}
        disabled={actions.busy !== null}
      >
        <span className="stake-chip-mark">{s.required && !accepted ? '🔒' : CHIP_MARK[item.decision]}</span>
        <span className="stake-chip-name judged-text">{s.name}</span>
      </button>
      {!s.required && item.decision !== 'rejected' ? (
        <button type="button" className="stake-chip-remove" onClick={() => void actions.reject(item)} title="否决">
          ×
        </button>
      ) : null}
    </div>
  );
}

function sortStakeholders(items: StakeItem[]): StakeItem[] {
  const weight = (x: StakeItem) => (x.body.power === 'high' ? 0 : 1) + (x.body.interest === 'high' ? 0 : 1);
  return [...items].sort((a, b) => {
    if (a.body.required !== b.body.required) return a.body.required ? -1 : 1;
    return weight(a) - weight(b);
  });
}

export function StakeholderList({ stakeholders }: { stakeholders: StakeItem[] }) {
  return (
    <div className="stake-list">
      {sortStakeholders(stakeholders).map((s) => <StakeholderRow key={s.id} item={s} />)}
    </div>
  );
}

function StakeholderRow({ item }: { item: StakeItem }) {
  const [editing, setEditing] = useState(false);
  const s = item.body;
  const q = quadrantOf(s);
  const state = item.decision === 'accepted' ? 'selected' : item.decision === 'rejected' ? 'is-rejected' : '';
  return (
    <div className={`stake-row ${state} ${s.required ? 'required' : ''}`}>
      <span className="stake-row-mark">{s.required ? '🔒' : item.decision === 'accepted' ? '★' : '☆'}</span>
      <div>
        <div className="stake-row-head">
          <span className="stake-row-name judged-text">{s.name}</span>
          <span className={`stake-row-cat cat-${s.category}`}>{CATEGORY_LABEL[s.category]}</span>
          <span className={`stake-row-quad q-${q}`}>{QUADRANT_META[q].title}</span>
          {s.required ? <span className="suggested-badge">基线 · 必选</span> : null}
          <StanceBadge stance={item.aiStance} />
        </div>
        <div className="stake-row-role">{s.role}</div>
        <div className="stake-row-note">{s.note}</div>
        {s.engagement_hint ? <div className="stake-row-hint"><b>如何对待</b>：{s.engagement_hint}</div> : null}
        <div className="stake-row-source">来源：{s.source}</div>
        {editing ? <EditableItemFields item={item} /> : null}
      </div>
      <ItemDecision
        item={item}
        rejectBlocked={s.required ? REQUIRED_REJECT_BLOCKED : undefined}
        onToggleEdit={() => setEditing((v) => !v)}
        editing={editing}
      />
    </div>
  );
}

const PLAN_ROWS: { key: Quadrant & keyof EngagementPlan }[] = [
  { key: 'manage' }, { key: 'satisfy' }, { key: 'inform' }, { key: 'monitor' },
];

export function EngagementPlanCards({ plan }: { plan: ItemOfType<'engagement_plan'> }) {
  return (
    <>
      <ItemDecision item={plan} variant="full" />
      <div className="engagement-cards" style={{ marginTop: 10 }}>
        {PLAN_ROWS.map(({ key }) => {
          const meta = QUADRANT_META[key];
          return (
            <div key={key} className={`engagement-card q-${key}`}>
              <div className="engagement-card-head">
                <span>{meta.title}</span>
                <span className="engagement-card-sub">{meta.subtitle}</span>
              </div>
              <div className="engagement-card-body">{plan.body[key]}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
