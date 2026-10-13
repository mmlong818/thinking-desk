'use client';

import { DIMENSION_KEYS, DIMENSION_META } from '@/lib/ai/schemas/analyze-scenarios';
import { useItemActions } from '@/components/project/useItemActions';
import { JudgeStrip } from '@/components/shared/JudgeStrip';
import { accepted, MAX_DEEP, type ElementItem, type ScenarioItem } from './scen-meta';

/** Elements by dimension; a click accepts / un-accepts. AI-recommended (high relevance) ones are outlined. */
export function DimensionsGrid({ elements, readOnly }: { elements: ElementItem[]; readOnly: boolean }) {
  const actions = useItemActions();
  return (
    <div className="scen-dim-list">
      {DIMENSION_KEYS.map((k) => {
        const meta = DIMENSION_META[k];
        const items = elements.filter((e) => e.body.dim === k);
        return (
          <div key={k} className="scen-dim-row">
            <div className="scen-dim-head">
              <div>
                <span className="scen-dim-label">{meta.label}</span>
                <span className="scen-dim-hint">{meta.hint}</span>
              </div>
              <span className="scen-dim-count">{accepted(items).length} / {items.length}</span>
            </div>
            <div className="scen-dim-items">
              {items.map((e) => {
                const on = e.decision === 'accepted';
                const recommended = !on && e.decision === 'pending' && e.aiStance?.verdict === 'recommend';
                return (
                  <button
                    type="button"
                    key={e.id}
                    className={`scen-elem rel-${e.body.relevance} ${on ? 'on' : ''} ${recommended ? 'is-recommended' : ''} ${e.decision === 'rejected' ? 'is-rejected' : ''}`}
                    onClick={() => !readOnly && void (on ? actions.reset(e) : actions.accept(e))}
                    disabled={readOnly || actions.busy !== null}
                    title={`相关度：${e.body.relevance}${recommended ? ' · AI 推荐' : ''}`}
                  >
                    {on ? '✓ ' : ''}
                    {e.body.text}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
      {actions.error ? <div className="idc-error">{actions.error}</div> : null}
    </div>
  );
}

/** Scenario cards: accepting one picks it for the deep analysis (at most MAX_DEEP). */
export function ScenariosGrid({ scenarios, readOnly }: { scenarios: ScenarioItem[]; readOnly: boolean }) {
  const guard = (s: ScenarioItem) => () =>
    s.decision !== 'accepted' && accepted(scenarios).length >= MAX_DEEP ? `最多深入 ${MAX_DEEP} 个情景` : null;
  return (
    <div className="scen-cards">
      {scenarios.map((s, i) => (
        <div key={s.id} className={`scen-card ${s.decision === 'accepted' ? 'picked' : ''} ${s.decision === 'rejected' ? 'is-rejected' : ''}`}>
          <div className="scen-card-head">
            <span className="scen-card-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="scen-card-title judged-text">{s.body.title}</span>
            {s.decision === 'accepted' ? <span className="scen-card-pick">✓ 已选</span> : null}
          </div>
          <div className="scen-card-meta">{s.body.meta}</div>
          <div className="scen-card-body">{s.body.narrative}</div>
          <div className="scen-card-hint"><b>隐约的不对劲：</b>{s.body.pain_hint}</div>
          {readOnly ? null : <JudgeStrip item={s} guardAccept={guard(s)} />}
        </div>
      ))}
    </div>
  );
}
