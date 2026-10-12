'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProbeResult, ProbeTurn } from '@/lib/ai/schemas/probe-brief';

type ProbeQuestion = Extract<ProbeResult, { action: 'question' }>;

interface Props {
  history: ProbeTurn[];
  current: ProbeQuestion | null;
  pending: boolean;
  onAnswer: (answer: string) => void;
  onSkipCurrent: () => void;
  onFinish: () => void;
}

export function BriefInterview({ history, current, pending, onAnswer, onSkipCurrent, onFinish }: Props) {
  return (
    <div className="interview">
      {history.length > 0 ? <InterviewHistory history={history} /> : null}
      {current ? (
        <CurrentQuestion
          key={current.question}
          turn={history.length + 1}
          current={current}
          pending={pending}
          canFinish={history.length > 0}
          onAnswer={onAnswer}
          onSkipCurrent={onSkipCurrent}
          onFinish={onFinish}
        />
      ) : pending ? (
        <div className="interview-loading"><span className="ai-spinner" /> &nbsp; 正在想下一个问题……</div>
      ) : null}
    </div>
  );
}

function InterviewHistory({ history }: { history: ProbeTurn[] }) {
  return (
    <div className="interview-history">
      {history.map((t, i) => (
        <div key={i} className="interview-turn">
          <div className="interview-q">
            <span className="interview-q-num">Q{i + 1}</span>
            <span className="interview-q-text">{t.question}</span>
          </div>
          <div className="interview-a">{t.answer}</div>
        </div>
      ))}
    </div>
  );
}

interface CurrentProps {
  turn: number;
  current: ProbeQuestion;
  pending: boolean;
  canFinish: boolean;
  onAnswer: (answer: string) => void;
  onSkipCurrent: () => void;
  onFinish: () => void;
}

/** Keyed by the question: a new question starts with an empty draft and selection. */
function CurrentQuestion({ turn, current, pending, canFinish, onAnswer, onSkipCurrent, onFinish }: CurrentProps) {
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(t);
  }, []);
  const hasHints = current.hints.length > 0;
  const answer = [picked.join('；'), draft.trim()].filter(Boolean).join('；');
  const submit = () => {
    if (!pending && answer) onAnswer(answer);
  };
  return (
    <div className="interview-current">
      <div className="interview-current-head">
        <span className="interview-current-num">Q{turn}</span>
        <span className="interview-current-remaining">
          {current.remaining_estimate > 0 ? `预计还剩 ${current.remaining_estimate} 轮` : '快收尾了'}
        </span>
      </div>
      <div className="interview-current-q">{current.question}</div>
      {current.why ? <div className="interview-current-why">{current.why}</div> : null}
      {hasHints ? (
        <HintPicker
          hints={current.hints}
          picked={picked}
          pending={pending}
          onToggle={(h) => setPicked((p) => (p.includes(h) ? p.filter((x) => x !== h) : [...p, h]))}
        />
      ) : null}
      <div className="interview-input-wrap">
        <div className="interview-input-divider">{hasHints ? '补充说明（可选）' : '请回答'}</div>
        <textarea
          ref={inputRef}
          className="interview-input"
          placeholder={hasHints ? '可以不填 · 或写下未列出的情况……（Shift+Enter 换行 · Enter 提交）' : '按你自己的话回答……（Enter 提交 · Shift+Enter 换行）'}
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), submit())}
          disabled={pending}
        />
        <InterviewActions pending={pending} canSubmit={!pending && !!answer} canFinish={canFinish} onSkip={onSkipCurrent} onFinish={onFinish} onSubmit={submit} />
      </div>
    </div>
  );
}

function HintPicker({ hints, picked, pending, onToggle }: {
  hints: string[];
  picked: string[];
  pending: boolean;
  onToggle: (hint: string) => void;
}) {
  return (
    <div className="interview-hints">
      <div className="interview-hints-label">可勾选一项或多项 · 也可在下方自己写</div>
      <div className="interview-hint-list">
        {hints.map((h, i) => {
          const checked = picked.includes(h);
          return (
            <label key={i} className={`interview-hint-row ${checked ? 'checked' : ''}`}>
              <input type="checkbox" className="interview-hint-check" checked={checked} onChange={() => !pending && onToggle(h)} disabled={pending} />
              <span className="interview-hint-text">{h}</span>
            </label>
          );
        })}
      </div>
      {picked.length > 0 ? (
        <div className="interview-hint-summary">已选 {picked.length} 项 — 可继续在下方补充，再点「回答 →」</div>
      ) : null}
    </div>
  );
}

function InterviewActions({ pending, canSubmit, canFinish, onSkip, onFinish, onSubmit }: {
  pending: boolean;
  canSubmit: boolean;
  canFinish: boolean;
  onSkip: () => void;
  onFinish: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="interview-actions">
      <button type="button" className="btn btn-ghost" onClick={onSkip} disabled={pending}>跳过这一问</button>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={onFinish}
        disabled={pending || !canFinish}
        title={!canFinish ? '至少答一轮再结束' : '提前结束追问，直接生成 Brief'}
      >
        结束追问 · 直接生成
      </button>
      <button type="button" className="btn btn-accent" onClick={onSubmit} disabled={!canSubmit}>
        {pending ? <><span className="ai-spinner" />&nbsp; 思考下一问</> : '回答 →'}
      </button>
    </div>
  );
}
