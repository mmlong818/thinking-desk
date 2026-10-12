'use client';

import { useMemo, useState } from 'react';
import type { BriefQuestion } from '@/lib/ai/schemas/clarify-brief';

const OTHER_VALUE = '__other__';

export interface ClarifierAnswer {
  question: string;
  answer: string | string[];
}

interface Props {
  reasoning: string;
  needType: string;
  questions: BriefQuestion[];
  onSubmit: (answers: ClarifierAnswer[]) => void;
  onSkip: () => void;
  pending: boolean;
}

const NEED_TYPE_LABEL: Record<string, string> = {
  design: '设计类',
  product: '产品类',
  mixed: '综合类',
  other: '通用',
};

export function BriefClarifier({ reasoning, needType, questions, onSubmit, onSkip, pending }: Props) {
  const [selections, setSelections] = useState<Record<string, string | string[]>>({});
  const [others, setOthers] = useState<Record<string, string>>({});
  const [cursor, setCursor] = useState(0);

  const total = questions.length;
  const isAnswered = (q: BriefQuestion): boolean => {
    const v = selections[q.id];
    if (v === undefined) return false;
    if (Array.isArray(v)) return v.length > 0;
    return v !== '';
  };

  const answered = useMemo(
    () => questions.filter(isAnswered).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selections, questions],
  );

  const setSingle = (id: string, val: string) => {
    setSelections((s) => ({ ...s, [id]: val }));
  };
  const toggleMulti = (id: string, val: string) => {
    setSelections((s) => {
      const current = Array.isArray(s[id]) ? (s[id] as string[]) : [];
      const next = current.includes(val) ? current.filter((x) => x !== val) : [...current, val];
      return { ...s, [id]: next };
    });
  };

  const buildPayload = (): ClarifierAnswer[] =>
    questions
      .filter((q) => selections[q.id] !== undefined)
      .map((q) => {
        const raw = selections[q.id];
        const resolve = (v: string) =>
          v === OTHER_VALUE && others[q.id]?.trim() ? `其他：${others[q.id].trim()}` : v;
        const answer: string | string[] = Array.isArray(raw)
          ? raw.map(resolve)
          : resolve(raw as string);
        return { question: q.title, answer };
      });

  const submit = () => onSubmit(buildPayload());

  const current = questions[cursor];
  const currentAnswered = current ? isAnswered(current) : false;
  const isLast = cursor >= total - 1;

  const goNext = () => {
    if (!currentAnswered) return;
    if (isLast) submit();
    else setCursor((c) => Math.min(c + 1, total - 1));
  };
  const goPrev = () => setCursor((c) => Math.max(c - 1, 0));

  if (!current) return null;

  return (
    <div className="clarifier">
      <div className="clarifier-hat">
        <span className="clarifier-hat-kind">需求澄清 · {NEED_TYPE_LABEL[needType] ?? needType}</span>
        <span className="clarifier-hat-progress">
          第 {cursor + 1} / {total} 题 · 已答 {answered}
        </span>
      </div>
      <div className="clarifier-progress-bar" aria-hidden>
        <div
          className="clarifier-progress-bar-fill"
          style={{ width: `${((cursor + (currentAnswered ? 1 : 0)) / total) * 100}%` }}
        />
      </div>
      <div className="clarifier-reasoning">
        <b>为什么要问：</b>
        {reasoning}
      </div>

      <div className="clarifier-questions">
        <div className="clarifier-q" key={current.id}>
          <div className="clarifier-q-head">
            <span className="clarifier-q-num">{String(cursor + 1).padStart(2, '0')}</span>
            <div>
              <div className="clarifier-q-title">
                {current.title}
                <span className="clarifier-q-type">{current.type === 'multi' ? '多选' : '单选'}</span>
              </div>
              {current.subtitle ? <div className="clarifier-q-sub">{current.subtitle}</div> : null}
            </div>
          </div>
          <div className="clarifier-opts">
            {current.options.map((opt) => {
              const isMulti = current.type === 'multi';
              const isOther = /其他/.test(opt);
              const value = isOther ? OTHER_VALUE : opt;
              const cur = selections[current.id];
              const checked = isMulti
                ? Array.isArray(cur) && cur.includes(value)
                : cur === value;
              return (
                <label
                  key={opt}
                  className={`clarifier-opt ${checked ? 'checked' : ''} ${isOther ? 'is-other' : ''}`}
                >
                  <input
                    type={isMulti ? 'checkbox' : 'radio'}
                    name={current.id}
                    value={value}
                    checked={checked}
                    onChange={() =>
                      isMulti ? toggleMulti(current.id, value) : setSingle(current.id, value)
                    }
                  />
                  <span>{opt}</span>
                  {isOther && checked ? (
                    <input
                      type="text"
                      className="clarifier-other-input"
                      placeholder="请补充……"
                      value={others[current.id] ?? ''}
                      onChange={(e) =>
                        setOthers((o) => ({ ...o, [current.id]: e.target.value }))
                      }
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : null}
                </label>
              );
            })}
          </div>
        </div>
      </div>

      <div className="clarifier-foot">
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={onSkip}
            disabled={pending}
            title="不回答任何题，直接用原文做抽取"
          >
            放弃问卷 · 直接分析
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={goPrev}
            disabled={pending || cursor === 0}
          >
            ← 上一题
          </button>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span className="dim" style={{ fontSize: 12 }}>
            {currentAnswered ? '可以下一题' : '请先回答这一题'}
          </span>
          <button
            type="button"
            className="btn btn-accent"
            onClick={goNext}
            disabled={pending || !currentAnswered}
          >
            {pending ? (
              <>
                <span className="ai-spinner" />
                &nbsp; 提交中
              </>
            ) : isLast ? (
              `基于答案分析 →`
            ) : (
              '下一题 →'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
