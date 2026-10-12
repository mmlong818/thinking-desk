'use client';

import type { BriefExtraction } from '@/lib/ai/schemas/extract-brief';
import { ErrorCard, ParaHead } from '@/components/shared/NodeKit';
import { EXAMPLE, stageHint, type Stage } from './brief-meta';
import { HighlightedPaste } from './HighlightedPaste';

interface Props {
  stage: Stage;
  rawText: string;
  onChange: (text: string) => void;
  onStart: () => void;
  /** Highlights of the extracted brief (after analysis). */
  highlights?: BriefExtraction['highlights'];
  error: string | null;
}

const EDITABLE: ReadonlyArray<Stage['kind']> = ['paste', 'clarifying', 'mode_choose'];

/** § 1 原始需求: the paste box until analysis starts, then the text with fact / assumption / missing highlights. */
export function PasteSection({ stage, rawText, onChange, onStart, highlights, error }: Props) {
  return (
    <div className="para-section">
      <ParaHead title="原始需求" hint={stageHint(stage)} />
      {EDITABLE.includes(stage.kind) ? (
        <PasteArea stage={stage} rawText={rawText} onChange={onChange} onStart={onStart} />
      ) : (
        <HighlightedPaste rawText={rawText} highlights={stage.kind === 'done' ? highlights : undefined} />
      )}
      <ErrorCard message={error} />
    </div>
  );
}

function PasteArea({ stage, rawText, onChange, onStart }: Pick<Props, 'stage' | 'rawText' | 'onChange' | 'onStart'>) {
  const busy = stage.kind === 'clarifying';
  return (
    <div className="paste-area">
      <textarea
        value={rawText}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`把原始需求文字粘进来……\n\n例如：\n${EXAMPLE}`}
        disabled={busy}
      />
      <div className="paste-foot">
        <span>{rawText.length} 字 · 支持中英混排 · 可直接粘贴会议纪要</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-ghost" onClick={() => onChange(EXAMPLE)} disabled={busy}>
            试试示例
          </button>
          <button type="button" className="btn btn-accent" onClick={onStart} disabled={busy || !rawText.trim()}>
            {busy ? <><span className="ai-spinner" />&nbsp; 判断中</> : '开始分析 →'}
          </button>
        </div>
      </div>
    </div>
  );
}
