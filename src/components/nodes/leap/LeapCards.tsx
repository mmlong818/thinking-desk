'use client';

import type { ReactNode } from 'react';
import { JudgeStrip } from '@/components/shared/JudgeStrip';
import { ParaHead } from '@/components/shared/NodeKit';
import { FEAS_META, FLIP_LABEL, type LeapItem } from './leap-meta';

const STATE_CLASS = { accepted: 'state-selected', rejected: 'state-rejected', pending: 'state-neutral' } as const;
const METHOD_CLASS = { first_principle: 'leap-fp', analogy: 'leap-analogy', constraint_flip: 'leap-flip' } as const;

interface SectionProps {
  num: string;
  title: string;
  hint: string;
  items: LeapItem[];
  regenerating: boolean;
  disabled: boolean;
  onRegenerate: () => void;
}

/** One leap method: its candidates (each judged), counts, and "⟳ 再补 3 条". */
export function CategorySection({ num, title, hint, items, regenerating, disabled, onRegenerate }: SectionProps) {
  const count = (d: LeapItem['decision']) => items.filter((it) => it.decision === d).length;
  return (
    <div className="para-section">
      <ParaHead num={num} title={title} hint={hint} />
      <div className="leap-list">
        {items.map((it, i) => (
          <div key={it.id} className={`leap-card ${METHOD_CLASS[it.type]} feas-${it.body.feasibility} ${STATE_CLASS[it.decision]}`}>
            <div className="leap-card-num">{String(i + 1).padStart(2, '0')}</div>
            <div className="leap-card-body">
              <LeapBody item={it} />
              <JudgeStrip item={it} />
            </div>
            <div className={`leap-feas ${FEAS_META[it.body.feasibility].cls}`}>{FEAS_META[it.body.feasibility].label}</div>
          </div>
        ))}
      </div>
      <div className="cat-footer">
        <div className="cat-footer-stats">
          <span className="cat-stat total">{items.length} 条</span>
          {count('accepted') > 0 ? <span className="cat-stat selected">✓ {count('accepted')} 采纳</span> : null}
          {count('rejected') > 0 ? <span className="cat-stat rejected">🗑 {count('rejected')} 否决</span> : null}
        </div>
        <button type="button" className="btn btn-ghost" onClick={onRegenerate} disabled={disabled}>
          {regenerating ? <><span className="ai-spinner" />&nbsp; 生成中</> : <>⟳ 再补 3 条（保留已有 · 避开否决）</>}
        </button>
      </div>
    </div>
  );
}

function LeapBody({ item }: { item: LeapItem }) {
  if (item.type === 'first_principle') {
    return (
      <>
        <Step label="行业共识" text={item.body.industry_assumption} />
        <div className="leap-step arrow">↓ 剥到物理 / 底层</div>
        <Step label="真实底层" text={item.body.physical_floor} />
        <div className="leap-step arrow">↓ 由此推出</div>
        <Step label="设计机会" text={item.body.opportunity} cls="opportunity" />
      </>
    );
  }
  if (item.type === 'analogy') return <AnalogyBody item={item} />;
  return <FlipBody item={item} />;
}

function Step({ label, text, cls }: { label: string; text: string; cls?: string }) {
  return (
    <div className={`leap-step ${cls ?? ''}`}>
      <span className="leap-step-label">{label}</span>
      <span className="leap-step-text judged-text">{text}</span>
    </div>
  );
}

function AnalogyBody({ item }: { item: Extract<LeapItem, { type: 'analogy' }> }) {
  const b = item.body;
  return (
    <>
      <div className="analogy-head">
        <span className="analogy-essence">本质：{b.core_essence}</span>
        <span className="analogy-arrow">借鉴自</span>
        <span className="analogy-source">{b.source_domain}</span>
      </div>
      <div className="analogy-row">
        <Col label="源领域机制">{b.source_mechanism}</Col>
        <Col label="迁移到本项目" accent>{b.transferred_mechanism}</Col>
      </div>
      <div className="analogy-notes"><b>适配提示：</b>{b.adaptation_notes}</div>
    </>
  );
}

function Col({ label, accent, children }: { label: string; accent?: boolean; children: ReactNode }) {
  return (
    <div className="analogy-col">
      <div className="analogy-col-label">{label}</div>
      <div className={`analogy-col-text judged-text ${accent ? 'accent' : ''}`}>{children}</div>
    </div>
  );
}

function FlipBody({ item }: { item: Extract<LeapItem, { type: 'constraint_flip' }> }) {
  const b = item.body;
  return (
    <>
      <div className="flip-type">{FLIP_LABEL[b.flip_type]}</div>
      <div className="flip-row">
        <div className="flip-original"><span className="flip-label">原约束</span><div>{b.original}</div></div>
        <div className="flip-arrow">→</div>
        <div className="flip-flipped"><span className="flip-label">反转后</span><div className="judged-text">{b.flipped}</div></div>
      </div>
      <div className="flip-surprise"><b>暴露了什么：</b>{b.surprise}</div>
      <div className="flip-impact"><b>对功能列表的影响：</b>{b.impact_on_features}</div>
    </>
  );
}
