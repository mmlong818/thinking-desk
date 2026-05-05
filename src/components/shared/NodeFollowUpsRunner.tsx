'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { FollowUpItem } from '@/lib/ai/follow-ups';

export type { FollowUpItem };

interface Props {
  items: FollowUpItem[];
  /** 已答字段 → 答案文本（多个用 ; 拼） */
  answers: Record<string, string>;
  pending?: boolean;
  onAnswer: (field: string, answer: string) => void;
}

export function NodeFollowUpsRunner({ items, answers, pending, onAnswer }: Props) {
  const firstUnansweredIdx = useMemo(
    () => items.findIndex((it) => !answers[it.field]),
    [items, answers],
  );
  const idx = firstUnansweredIdx === -1 ? items.length : firstUnansweredIdx;
  const total = items.length;
  const done = idx >= total;
  const current = done ? null : items[idx];

  const [picked, setPicked] = useState<string[]>([]);
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);

  // 切题清状态、聚焦
  useEffect(() => {
    setPicked([]);
    setDraft('');
    if (current) {
      const t = setTimeout(() => taRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
  }, [current?.field]);

  if (done) {
    return (
      <div className="cop-runner cop-runner-done">
        <div className="cop-runner-done-tag">追问 · 已全部回答</div>
        <div className="cop-runner-done-body">
          已补齐 <b>{total}</b> 处缺失。下方主区的字段已更新，可继续编辑或进入下一节点。
        </div>
      </div>
    );
  }
  if (!current) return null;

  const togglePick = (opt: string) => {
    if (pending) return;
    setPicked((p) => (p.includes(opt) ? p.filter((x) => x !== opt) : [...p, opt]));
  };

  const buildAnswer = (): string => {
    const a = picked.join('；');
    const b = draft.trim();
    if (a && b) return `${a}；${b}`;
    return a || b;
  };

  const submit = () => {
    if (pending) return;
    const ans = buildAnswer();
    if (!ans) return;
    onAnswer(current.field, ans);
  };

  const canSubmit = !pending && (picked.length > 0 || draft.trim().length > 0);

  return (
    <div className="cop-runner">
      <div className="cop-runner-head">
        <span className="cop-runner-tag">追问 · ASK</span>
        <span className="cop-runner-progress">第 {idx + 1} / {total} 题</span>
      </div>
      <div className="cop-runner-progress-bar" aria-hidden>
        <div
          className="cop-runner-progress-bar-fill"
          style={{ width: `${(idx / total) * 100}%` }}
        />
      </div>
      <div className="cop-runner-q">{current.question}</div>
      {current.why ? <div className="cop-runner-why">{current.why}</div> : null}

      {current.options && current.options.length > 0 ? (
        <div className="cop-runner-opts">
          <div className="cop-runner-opts-label">可勾选一项或多项 · 也可在下方自己写</div>
          <div className="cop-runner-opts-list">
            {current.options.map((opt) => {
              const checked = picked.includes(opt);
              return (
                <label
                  key={opt}
                  className={`cop-runner-opt ${checked ? 'checked' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => togglePick(opt)}
                    disabled={pending}
                  />
                  <span>{opt}</span>
                </label>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="cop-runner-input-wrap">
        <div className="cop-runner-input-label">
          {current.options && current.options.length > 0 ? '补充说明（可选）' : '请回答'}
        </div>
        <textarea
          ref={taRef}
          className="cop-runner-input"
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={
            current.options && current.options.length > 0
              ? '可以不填 · 或写下未列出的情况……'
              : '按你自己的话回答……（Enter 提交）'
          }
          disabled={pending}
        />
        <div className="cop-runner-actions">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={() => onAnswer(current.field, '〔跳过〕')}
            disabled={pending}
            title="跳过这一题，留着以后再补"
          >
            跳过
          </button>
          <button
            type="button"
            className="btn btn-accent btn-xs"
            onClick={submit}
            disabled={!canSubmit}
          >
            记下答案 →
          </button>
        </div>
      </div>
    </div>
  );
}
