'use client';

import { useEffect, useRef, useState } from 'react';
import type { ProbeResult, ProbeTurn } from '@/lib/ai/tasks/probe-brief';

interface Props {
  rawText: string;
  history: ProbeTurn[];
  current: Extract<ProbeResult, { action: 'question' }> | null;
  pending: boolean;
  onAnswer: (answer: string) => void;
  onSkipCurrent: () => void;
  onFinish: () => void;
}

export function BriefInterview({
  rawText: _rawText,
  history,
  current,
  pending,
  onAnswer,
  onSkipCurrent,
  onFinish,
}: Props) {
  const [draft, setDraft] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus new question, clear state.
  useEffect(() => {
    setDraft('');
    setPicked([]);
    if (current) {
      const t = setTimeout(() => inputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [current?.question]);

  const togglePick = (hint: string) => {
    if (pending) return;
    setPicked((p) => (p.includes(hint) ? p.filter((x) => x !== hint) : [...p, hint]));
  };

  const buildAnswer = (): string => {
    const pickedJoined = picked.join('；');
    const free = draft.trim();
    if (pickedJoined && free) return `${pickedJoined}；${free}`;
    return pickedJoined || free;
  };

  const submit = () => {
    if (pending) return;
    const ans = buildAnswer();
    if (!ans) return;
    onAnswer(ans);
  };

  const canSubmit = !pending && (picked.length > 0 || draft.trim().length > 0);

  return (
    <div className="interview">
      {/* 历史对话 */}
      {history.length > 0 ? (
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
      ) : null}

      {/* 当前问题 */}
      {current ? (
        <div className="interview-current">
          <div className="interview-current-head">
            <span className="interview-current-num">Q{history.length + 1}</span>
            <span className="interview-current-remaining">
              {current.remaining_estimate > 0
                ? `预计还剩 ${current.remaining_estimate} 轮`
                : '快收尾了'}
            </span>
          </div>
          <div className="interview-current-q">{current.question}</div>
          {current.why ? <div className="interview-current-why">{current.why}</div> : null}

          {current.hints && current.hints.length > 0 ? (
            <div className="interview-hints">
              <div className="interview-hints-label">
                可勾选一项或多项 · 也可在下方自己写
              </div>
              <div className="interview-hint-list">
                {current.hints.map((h, i) => {
                  const checked = picked.includes(h);
                  return (
                    <label
                      key={i}
                      className={`interview-hint-row ${checked ? 'checked' : ''}`}
                    >
                      <input
                        type="checkbox"
                        className="interview-hint-check"
                        checked={checked}
                        onChange={() => togglePick(h)}
                        disabled={pending}
                      />
                      <span className="interview-hint-text">{h}</span>
                    </label>
                  );
                })}
              </div>
              {picked.length > 0 ? (
                <div className="interview-hint-summary">
                  已选 {picked.length} 项 — 可继续在下方补充，再点「回答 →」
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="interview-input-wrap">
            <div className="interview-input-divider">
              {current.hints && current.hints.length > 0 ? '补充说明（可选）' : '请回答'}
            </div>
            <textarea
              ref={inputRef}
              className="interview-input"
              placeholder={
                current.hints && current.hints.length > 0
                  ? '可以不填 · 或写下未列出的情况……（Shift+Enter 换行 · Enter 提交）'
                  : '按你自己的话回答……（Enter 提交 · Shift+Enter 换行）'
              }
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={pending}
            />
            <div className="interview-actions">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onSkipCurrent}
                disabled={pending}
              >
                跳过这一问
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={onFinish}
                disabled={pending || history.length === 0}
                title={history.length === 0 ? '至少答一轮再结束' : '提前结束追问，直接生成 Brief'}
              >
                结束追问 · 直接生成
              </button>
              <button
                type="button"
                className="btn btn-accent"
                onClick={submit}
                disabled={!canSubmit}
              >
                {pending ? (
                  <>
                    <span className="ai-spinner" />
                    &nbsp; 思考下一问
                  </>
                ) : (
                  '回答 →'
                )}
              </button>
            </div>
          </div>
        </div>
      ) : pending ? (
        <div className="interview-loading">
          <span className="ai-spinner" /> &nbsp; 正在想下一个问题……
        </div>
      ) : null}
    </div>
  );
}
