'use client';

import type { BriefRequestContext } from '@/lib/model/context';
import type { ItemOfType } from '@/lib/model/context';
import { UpstreamContext } from '@/components/shared/UpstreamContext';

/** The full brief snapshot the JTBD analysis reads (fields, answers, open questions, raw text). */
export function BriefContextCard({ ctx, brief }: { ctx: BriefRequestContext; brief: ItemOfType<'brief'> }) {
  const count = (kind: string) => ctx.brief.highlights.filter((h) => h.kind === kind).length;
  const followUps = brief.body.follow_ups;
  const summary = `BRIEF 上下文快照 · 完整度 ${brief.body.completeness}% · ${count('fact')} 事实 · ${count('assumption')} 假设 · ${count('missing')} 缺失`;
  return (
    <UpstreamContext brief={ctx} summary={summary} full>
      {ctx.answers && ctx.answers.length > 0 ? (
        <div className="ctx-section">
          <div className="ctx-section-title">澄清回答 · {ctx.answers.length} 条</div>
          {ctx.answers.map((a, i) => (
            <div key={i} className="ctx-qa">
              <div className="ctx-q">{a.question}</div>
              <div className="ctx-a">{Array.isArray(a.answer) ? a.answer.join(' · ') : a.answer}</div>
            </div>
          ))}
        </div>
      ) : null}
      {followUps.length > 0 ? (
        <div className="ctx-section">
          <div className="ctx-section-title">AI 仍在追问 · {followUps.length} 条</div>
          {followUps.map((q, i) => (
            <div key={i} className="ctx-qa">
              <div className="ctx-q">{q.question}</div>
              {q.why ? <div className="ctx-why">{q.why}</div> : null}
            </div>
          ))}
        </div>
      ) : null}
      {ctx.rawText ? (
        <details className="ctx-section ctx-raw">
          <summary>原始需求文字 · {ctx.rawText.length} 字</summary>
          <div className="ctx-raw-body">{ctx.rawText}</div>
        </details>
      ) : null}
    </UpstreamContext>
  );
}
