'use client';

import { useMemo } from 'react';
import type { BriefExtraction } from '@/lib/ai/schemas/extract-brief';

type Kind = 'fact' | 'assumption' | 'missing';
type Highlight = BriefExtraction['highlights'][number];

interface Part {
  text: string;
  kind?: Kind;
}

/** Splits the raw text into plain / highlighted runs; missing items not found in the text are appended. */
function toParts(rawText: string, highlights: Highlight[]): Part[] {
  const ranges = highlights
    .map((h) => ({ idx: rawText.indexOf(h.text), len: h.text.length, kind: h.kind }))
    .filter((r) => r.idx >= 0)
    .sort((a, b) => a.idx - b.idx);
  const parts: Part[] = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.idx < cursor) continue;
    if (r.idx > cursor) parts.push({ text: rawText.slice(cursor, r.idx) });
    parts.push({ text: rawText.slice(r.idx, r.idx + r.len), kind: r.kind });
    cursor = r.idx + r.len;
  }
  if (cursor < rawText.length) parts.push({ text: rawText.slice(cursor) });
  const extraMissing = highlights.filter((h) => h.kind === 'missing' && rawText.indexOf(h.text) === -1);
  if (extraMissing.length > 0) {
    parts.push({ text: ' ' });
    for (const m of extraMissing) parts.push({ text: m.text, kind: 'missing' });
  }
  return parts;
}

export function HighlightedPaste({ rawText, highlights }: { rawText: string; highlights?: Highlight[] }) {
  const parts = useMemo(() => (highlights ? toParts(rawText, highlights) : [{ text: rawText }]), [rawText, highlights]);
  const count = (k: Kind) => (highlights ?? []).filter((h) => h.kind === k).length;
  return (
    <div className="paste-box">
      <div>
        {parts.map((p, i) =>
          p.kind ? (
            <span key={i} className={`hl hl-${p.kind === 'assumption' ? 'assume' : p.kind}`}>{p.text}</span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>
      {highlights ? (
        <div className="hl-legend">
          <span><span className="hl-dot" style={{ background: 'var(--fact-b)' }} />事实</span>
          <span><span className="hl-dot" style={{ background: 'var(--assumption-b)' }} />假设</span>
          <span><span className="hl-dot" style={{ background: 'var(--missing-b)' }} />缺失</span>
          <span className="dim" style={{ marginLeft: 'auto' }}>
            {count('fact')} 事实 · {count('assumption')} 假设 · {count('missing')} 缺失
          </span>
        </div>
      ) : null}
    </div>
  );
}
