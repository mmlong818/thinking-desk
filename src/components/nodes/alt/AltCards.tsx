'use client';

import { useState, type ReactNode } from 'react';
import type { ItemOfType } from '@/lib/model/context';
import type { Link } from '@/lib/model/types';
import { linkedIds } from '@/lib/store/request-context';
import { EditableItemFields } from '@/components/shared/EditableItemFields';
import { EvidenceLine, ItemDecision, RejectionNote, StanceBadge } from '@/components/shared/ItemDecision';
import { CATEGORY_META, MOAT_META, THREAT_META, type AltItem } from './alt-meta';

export function AlternativesOverview({ alternatives }: { alternatives: AltItem[] }) {
  return (
    <div className="alt-overview">
      {(['non_consumption', 'direct', 'indirect'] as const).map((cat) => {
        const meta = CATEGORY_META[cat];
        const items = alternatives.filter((a) => a.body.category === cat);
        return (
          <div key={cat} className={`alt-group alt-group-${meta.cls}`}>
            <div className="alt-group-head">
              <span className="alt-group-label">{meta.label}</span>
              <span className="alt-group-sub">{meta.sub}</span>
              <span className="alt-group-hint">{meta.hint}</span>
              <span className="alt-group-count">{items.length} 个</span>
            </div>
            {items.length === 0 ? (
              <div className="alt-empty">（此类没有识别到）</div>
            ) : (
              <div className="alt-list">{items.map((a) => <AltCard key={a.id} item={a} />)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AltCard({ item }: { item: AltItem }) {
  const [editing, setEditing] = useState(false);
  const a = item.body;
  const threat = THREAT_META[a.threat_level];
  const judged = item.decision === 'accepted' ? 'is-accepted' : item.decision === 'rejected' ? 'is-rejected' : '';
  return (
    <div className={`alt-card threat-${threat.cls} ${judged}`}>
      <div className="alt-card-head">
        <span className="alt-card-name judged-text">{a.name}</span>
        <span className={`alt-threat ${threat.cls}`}>{threat.label}</span>
      </div>
      <div className="alt-card-desc">{a.description}</div>
      <div className="alt-card-job"><b>用户为什么用它：</b>{a.why_users_use}</div>
      {a.sources.length > 0 ? (
        <div className="alt-card-sources">
          {a.sources.slice(0, 3).map((s, i) => (
            <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="alt-source-link">[source {i + 1}]</a>
          ))}
        </div>
      ) : null}
      <EvidenceLine evidence={item.evidence} />
      <div className="alt-card-judge">
        <StanceBadge stance={item.aiStance} />
        <ItemDecision item={item} onToggleEdit={() => setEditing((v) => !v)} editing={editing} showNote={false} />
      </div>
      <RejectionNote item={item} />
      {editing ? <EditableItemFields item={item} /> : null}
    </div>
  );
}

const altFor = (alternatives: AltItem[], links: Link[], fromId: string) => {
  const [altId] = linkedIds(links, fromId, 'derived_from');
  return alternatives.find((a) => a.id === altId);
};

export function StrategicProfiles({ alternatives, profiles, links }: {
  alternatives: AltItem[];
  profiles: ItemOfType<'alt_profile'>[];
  links: Link[];
}) {
  return (
    <div className="profile-list">
      {profiles.map((p) => {
        const alt = altFor(alternatives, links, p.id);
        if (!alt) return null;
        const moat = MOAT_META[p.body.moat_strength];
        const cat = CATEGORY_META[alt.body.category];
        return (
          <div key={p.id} className="profile-card">
            <div className="profile-head">
              <span className="profile-name">{alt.body.name}</span>
              <span className={`profile-category ${cat.cls}`}>{cat.label}</span>
            </div>
            <div className="profile-grid">
              <ProfileField label="承诺 · Promise" value={p.body.promise} cls="promise" />
              <ProfileField label="赢利模式 · Revenue" value={p.body.revenue_model} />
              <ProfileField label={<>护城河 · Moat <span className={`moat-badge ${moat.cls}`}>{moat.label}</span></>} value={p.body.moat} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ProfileField({ label, value, cls }: { label: ReactNode; value: string; cls?: string }) {
  return (
    <div className="profile-field">
      <div className="profile-field-label">{label}</div>
      <div className={`profile-field-value ${cls ?? ''}`}>{value}</div>
    </div>
  );
}

export function FeatureBreakdowns({ alternatives, breakdowns, links }: {
  alternatives: AltItem[];
  breakdowns: ItemOfType<'alt_breakdown'>[];
  links: Link[];
}) {
  return (
    <div className="breakdown-list">
      {breakdowns.map((b) => {
        const alt = altFor(alternatives, links, b.id);
        if (!alt) return null;
        return (
          <div key={b.id} className="breakdown-card">
            <div className="breakdown-head">{alt.body.name}</div>
            <BreakdownRow label="菜单结构" items={b.body.menu_structure} />
            <BreakdownRow label="核心流程" items={b.body.core_flows} />
            <BreakdownRow label="关键交互" items={b.body.key_interactions} />
            <BreakdownRow label="亮点功能" items={b.body.headline_features} accent />
          </div>
        );
      })}
    </div>
  );
}

function BreakdownRow({ label, items, accent }: { label: string; items: string[]; accent?: boolean }) {
  if (items.length === 0) return null;
  return (
    <div className="breakdown-row">
      <div className="breakdown-row-label">{label}</div>
      <div className="breakdown-row-items">
        {items.map((it, i) => <span key={i} className={`breakdown-chip ${accent ? 'accent' : ''}`}>{it}</span>)}
      </div>
    </div>
  );
}
