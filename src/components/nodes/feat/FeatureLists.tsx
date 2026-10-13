'use client';

import { useMemo, useState } from 'react';
import { KANO_META, type KanoKind } from '@/lib/ai/schemas/draft-features';
import type { ItemOfType } from '@/lib/model/context';
import type { Item } from '@/lib/model/item-types';
import type { Link } from '@/lib/model/types';
import { JudgeStrip, judgedClass } from '@/components/shared/JudgeStrip';
import { FeatureCard } from './FeatureCard';
import { isRecommended, KANO_FILTER_KEYS, NOT_DOING_REASON, pillarOf, type FeatureItem, type KanoFilter, type PillarItem } from './feat-meta';

export function PillarsStrip({ pillars, features }: { pillars: PillarItem[]; features: FeatureItem[] }) {
  return (
    <div className="pillar-strip">
      {pillars.map((p) => (
        <div key={p.id} className="pillar-card">
          <div className="pillar-name">{p.body.name}</div>
          <div className="pillar-desc">{p.body.description}</div>
          <div className="pillar-count">{features.filter((f) => pillarOf(f, pillars)?.id === p.id).length} 个功能</div>
        </div>
      ))}
    </div>
  );
}

function FeatureFilters({ kano, suggestedOnly, features, onKano, onSuggested }: {
  kano: KanoFilter;
  suggestedOnly: boolean;
  features: FeatureItem[];
  onKano: (k: KanoFilter) => void;
  onSuggested: () => void;
}) {
  const count = (k: KanoFilter) => (k === 'all' ? features.length : features.filter((f) => f.body.kano === k).length);
  return (
    <div className="feature-filters">
      {KANO_FILTER_KEYS.map((k) => {
        const meta = k === 'all' ? null : KANO_META[k as KanoKind];
        return (
          <button key={k} type="button" className={`kano-pill ${meta ? meta.cls : 'all'} ${kano === k ? 'on' : ''}`} onClick={() => onKano(k)}>
            {meta ? meta.short : '全部'}
            <span className="kano-count">{count(k)}</span>
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <label className="suggested-toggle">
        <input type="checkbox" checked={suggestedOnly} onChange={onSuggested} />
        <span>仅显示 AI 建议优先</span>
      </label>
    </div>
  );
}

interface PyramidProps {
  pillars: PillarItem[];
  features: FeatureItem[];
  links: Link[];
  all: Item[];
  /** Hide the Kano / "AI 建议" filters (the final node's compact list). */
  plain?: boolean;
}

/** Features grouped by pillar, highest RICE first; filters and the expanded card are view state. */
export function FeaturePyramid({ pillars, features, links, all, plain }: PyramidProps) {
  const [kano, setKano] = useState<KanoFilter>('all');
  const [suggestedOnly, setSuggestedOnly] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all]);
  const filtering = kano !== 'all' || suggestedOnly;
  const shown = features.filter((f) => (kano === 'all' || f.body.kano === kano) && (!suggestedOnly || isRecommended(f)));
  const groups = [...pillars.map((p) => ({ key: p.id, name: p.body.name, desc: p.body.description })), { key: '', name: '未归类', desc: '' }];
  return (
    <>
      {plain ? null : (
        <FeatureFilters kano={kano} suggestedOnly={suggestedOnly} features={features} onKano={setKano} onSuggested={() => setSuggestedOnly((v) => !v)} />
      )}
      <div className="feature-pyramid">
        {groups.map((g) => {
          const items = shown.filter((f) => (pillarOf(f, pillars)?.id ?? '') === g.key).sort((a, b) => b.body.rice_score - a.body.rice_score);
          if (items.length === 0 && (filtering || g.key === '')) return null;
          return (
            <div key={g.key || 'none'} className="pillar-section">
              <div className="pillar-section-head">
                <span className="pillar-section-name">{g.name}</span>
                <span className="pillar-section-desc">{g.desc}</span>
                <span className="pillar-section-count">{items.length} 个</span>
              </div>
              <div className="feature-list-v2">
                {items.map((f) => (
                  <FeatureCard key={f.id} item={f} expanded={expandedId === f.id} links={links} byId={byId}
                    onExpand={() => setExpandedId((id) => (id === f.id ? null : f.id))} />
                ))}
                {items.length === 0 ? <div className="dim" style={{ fontStyle: 'italic', padding: '10px 0', fontSize: 12 }}>此支柱下没有符合过滤器的功能</div> : null}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function NotDoingList({ items }: { items: ItemOfType<'not_doing'>[] }) {
  return (
    <div className="not-doing-list">
      {items.map((it) => {
        const meta = NOT_DOING_REASON[it.body.reason];
        return (
          <div key={it.id} className={`not-doing-item reason-${meta.cls} ${judgedClass(it)}`}>
            <div className="not-doing-head">
              <span className="not-doing-name judged-text">{it.body.name}</span>
              <span className={`not-doing-reason reason-${meta.cls}`}>{meta.label}</span>
            </div>
            <div className="not-doing-why">{it.body.why}</div>
            <JudgeStrip item={it} />
          </div>
        );
      })}
    </div>
  );
}
