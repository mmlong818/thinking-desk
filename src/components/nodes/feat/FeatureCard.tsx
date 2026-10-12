'use client';

import { useState } from 'react';
import { KANO_META } from '@/lib/ai/schemas/draft-features';
import type { Item } from '@/lib/model/item-types';
import type { Link } from '@/lib/model/types';
import { EditableItemFields } from '@/components/shared/EditableItemFields';
import { ItemDecision, RejectionNote, StanceBadge } from '@/components/shared/ItemDecision';
import { judgedClass } from '@/components/shared/JudgeStrip';
import type { FeatureItem } from './feat-meta';

interface CardProps {
  item: FeatureItem;
  expanded: boolean;
  onExpand: () => void;
  links: Link[];
  byId: Map<string, Item>;
}

export function FeatureCard({ item, expanded, onExpand, links, byId }: CardProps) {
  const [editing, setEditing] = useState(false);
  const f = item.body;
  const kanoMeta = KANO_META[f.kano];
  return (
    <div className={`feature-v2 kano-${kanoMeta.cls} ${expanded ? 'expanded' : ''} ${f.red_line_risk ? 'red-line' : ''} ${judgedClass(item)}`}>
      <div className="feature-v2-head">
        <ItemDecision item={item} showNote={false} onToggleEdit={() => setEditing((v) => !v)} editing={editing} />
        <button type="button" className="feature-v2-main" onClick={onExpand}>
          <div className="feature-v2-top">
            <span className={`kano-pill inline ${kanoMeta.cls}`} title={kanoMeta.hint}>{kanoMeta.short}</span>
            <span className="feature-v2-name judged-text">{f.name}</span>
            {f.red_line_risk ? <span className="red-line-flag">⚠ 红线</span> : null}
            <StanceBadge stance={item.aiStance} />
            <span className="feature-v2-rice">RICE {f.rice_score}</span>
          </div>
          <div className="feature-v2-desc">{f.description}</div>
        </button>
      </div>
      <RejectionNote item={item} />
      {editing ? <EditableItemFields item={item} /> : null}
      {expanded ? <FeatureDetail item={item} links={links} byId={byId} /> : null}
    </div>
  );
}

function FeatureDetail({ item, links, byId }: { item: FeatureItem; links: Link[]; byId: Map<string, Item> }) {
  const f = item.body;
  return (
    <div className="feature-v2-detail">
      <div className="detail-row">
        <div className="detail-label">RICE 拆解</div>
        <div className="detail-value">
          <span className="rice-cell">R {f.rice.reach}</span><span className="rice-sep">×</span>
          <span className="rice-cell">I {f.rice.impact}</span><span className="rice-sep">×</span>
          <span className="rice-cell">C {f.rice.confidence}</span><span className="rice-sep">÷</span>
          <span className="rice-cell">E {f.rice.effort}</span><span className="rice-sep">=</span>
          <span className="rice-cell final">{f.rice_score}</span>
        </div>
      </div>
      <div className="detail-row">
        <div className="detail-label">§9.4 五问法</div>
        <div className="detail-value five-q-list">
          <FiveQItem label="Q1 为什么做" text={f.five_questions.why_do} />
          <FiveQItem label="Q2 为什么这么做" text={f.five_questions.why_this_way} />
          <FiveQItem label="Q3 还能怎么做" text={f.five_questions.alternatives} />
          <FiveQItem label="Q4 不做会怎样" text={f.five_questions.what_if_not} />
          <FiveQItem label="Q5 ★ 做错会怎样" text={f.five_questions.what_if_wrong} accent />
        </div>
      </div>
      <div className="detail-row">
        <div className="detail-label">§9.5 功能卡片 = 假设</div>
        <div className="detail-value hypothesis-card">
          <div className="hyp-item"><span className="hyp-label">核心假设</span><span>{f.core_hypothesis}</span></div>
          <div className="hyp-item"><span className="hyp-label">验证指标</span><span>{f.validation_metric}</span></div>
          <div className="hyp-item"><span className="hyp-label">失败信号</span><span style={{ color: 'var(--danger)' }}>{f.failure_signal}</span></div>
        </div>
      </div>
      {f.ethics_concern ? (
        <div className="detail-row">
          <div className="detail-label">伦理前哨</div>
          <div className="detail-value ethics-warn">
            ⚠ {f.ethics_concern}
            <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>完整七问审查会在 §十一 伦理审查节点进行</div>
          </div>
        </div>
      ) : null}
      <Traces featureId={item.id} links={links} byId={byId} />
    </div>
  );
}

/** "来源追溯": the insights / scenarios the feature derives from and the jobs it serves (its Links). */
function Traces({ featureId, links, byId }: { featureId: string; links: Link[]; byId: Map<string, Item> }) {
  const chips = links
    .filter((l) => l.from === featureId)
    .map((l) => byId.get(l.to))
    .filter((t): t is Item => !!t && ['insight', 'job', 'scenario'].includes(t.type));
  if (chips.length === 0) return null;
  return (
    <div className="detail-row">
      <div className="detail-label">来源追溯</div>
      <div className="detail-value traces">
        {chips.map((t) => <TraceChip key={t.id} item={t} />)}
      </div>
    </div>
  );
}

function TraceChip({ item }: { item: Item }) {
  if (item.type === 'insight') {
    return <span className="trace-chip insight" title={item.body.insight_text}>启发 · {item.body.action.slice(0, 20)}</span>;
  }
  if (item.type === 'job') return <span className="trace-chip job">Job · {item.body.title.slice(0, 20)}</span>;
  if (item.type === 'scenario') return <span className="trace-chip scen">情景 · {item.body.title}</span>;
  return null;
}

function FiveQItem({ label, text, accent }: { label: string; text: string; accent?: boolean }) {
  return (
    <div className={`five-q ${accent ? 'accent' : ''}`}>
      <div className="five-q-label">{label}</div>
      <div className="five-q-text">{text}</div>
    </div>
  );
}
