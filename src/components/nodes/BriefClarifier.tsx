'use client';

import { useState } from 'react';
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

type Selections = Record<string, string | string[]>;

function useClarifierAnswers(questions: BriefQuestion[]) {
  const [selections, setSelections] = useState<Selections>({});
  const [others, setOthers] = useState<Record<string, string>>({});
  const isAnswered = (q: BriefQuestion): boolean => {
    const v = selections[q.id];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '';
  };
  const setSingle = (id: string, val: string) => setSelections((s) => ({ ...s, [id]: val }));
  const toggleMulti = (id: string, val: string) =>
    setSelections((s) => {
      const current = Array.isArray(s[id]) ? (s[id] as string[]) : [];
      return { ...s, [id]: current.includes(val) ? current.filter((x) => x !== val) : [...current, val] };
    });
  const setOther = (id: string, text: string) => setOthers((o) => ({ ...o, [id]: text }));
  const payload = (): ClarifierAnswer[] =>
    questions
      .filter((q) => selections[q.id] !== undefined)
      .map((q) => {
        const raw = selections[q.id];
        const resolve = (v: string) => (v === OTHER_VALUE && others[q.id]?.trim() ? `其他：${others[q.id].trim()}` : v);
        return { question: q.title, answer: Array.isArray(raw) ? raw.map(resolve) : resolve(raw) };
      });
  return { selections, others, isAnswered, setSingle, toggleMulti, setOther, payload, answered: questions.filter(isAnswered).length };
}

type Answers = ReturnType<typeof useClarifierAnswers>;

export function BriefClarifier({ reasoning, needType, questions, onSubmit, onSkip, pending }: Props) {
  const answers = useClarifierAnswers(questions);
  const [cursor, setCursor] = useState(0);
  const total = questions.length;
  const current = questions[cursor];
  if (!current) return null;
  const currentAnswered = answers.isAnswered(current);
  const isLast = cursor >= total - 1;
  const goNext = () => {
    if (!currentAnswered) return;
    if (isLast) onSubmit(answers.payload());
    else setCursor((c) => Math.min(c + 1, total - 1));
  };
  return (
    <div className="clarifier">
      <div className="clarifier-hat">
        <span className="clarifier-hat-kind">需求澄清 · {NEED_TYPE_LABEL[needType] ?? needType}</span>
        <span className="clarifier-hat-progress">第 {cursor + 1} / {total} 题 · 已答 {answers.answered}</span>
      </div>
      <div className="clarifier-progress-bar" aria-hidden>
        <div className="clarifier-progress-bar-fill" style={{ width: `${((cursor + (currentAnswered ? 1 : 0)) / total) * 100}%` }} />
      </div>
      <div className="clarifier-reasoning"><b>为什么要问：</b>{reasoning}</div>
      <div className="clarifier-questions">
        <ClarifierQuestion key={current.id} question={current} index={cursor} answers={answers} />
      </div>
      <ClarifierFoot
        pending={pending} canGoBack={cursor > 0} answered={currentAnswered} isLast={isLast}
        onSkip={onSkip} onPrev={() => setCursor((c) => Math.max(c - 1, 0))} onNext={goNext}
      />
    </div>
  );
}

function ClarifierQuestion({ question: q, index, answers }: { question: BriefQuestion; index: number; answers: Answers }) {
  return (
    <div className="clarifier-q">
      <div className="clarifier-q-head">
        <span className="clarifier-q-num">{String(index + 1).padStart(2, '0')}</span>
        <div>
          <div className="clarifier-q-title">
            {q.title}
            <span className="clarifier-q-type">{q.type === 'multi' ? '多选' : '单选'}</span>
          </div>
          {q.subtitle ? <div className="clarifier-q-sub">{q.subtitle}</div> : null}
        </div>
      </div>
      <div className="clarifier-opts">
        {q.options.map((opt) => <ClarifierOption key={opt} question={q} option={opt} answers={answers} />)}
      </div>
    </div>
  );
}

function ClarifierOption({ question: q, option, answers }: { question: BriefQuestion; option: string; answers: Answers }) {
  const isMulti = q.type === 'multi';
  const isOther = /其他/.test(option);
  const value = isOther ? OTHER_VALUE : option;
  const cur = answers.selections[q.id];
  const checked = isMulti ? Array.isArray(cur) && cur.includes(value) : cur === value;
  return (
    <label className={`clarifier-opt ${checked ? 'checked' : ''} ${isOther ? 'is-other' : ''}`}>
      <input
        type={isMulti ? 'checkbox' : 'radio'}
        name={q.id}
        value={value}
        checked={checked}
        onChange={() => (isMulti ? answers.toggleMulti(q.id, value) : answers.setSingle(q.id, value))}
      />
      <span>{option}</span>
      {isOther && checked ? (
        <input
          type="text"
          className="clarifier-other-input"
          placeholder="请补充……"
          value={answers.others[q.id] ?? ''}
          onChange={(e) => answers.setOther(q.id, e.target.value)}
          onClick={(e) => e.stopPropagation()}
        />
      ) : null}
    </label>
  );
}

function ClarifierFoot({ pending, canGoBack, answered, isLast, onSkip, onPrev, onNext }: {
  pending: boolean;
  canGoBack: boolean;
  answered: boolean;
  isLast: boolean;
  onSkip: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="clarifier-foot">
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn btn-ghost" onClick={onSkip} disabled={pending} title="不回答任何题，直接用原文做抽取">
          放弃问卷 · 直接分析
        </button>
        <button type="button" className="btn btn-ghost" onClick={onPrev} disabled={pending || !canGoBack}>
          ← 上一题
        </button>
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="dim" style={{ fontSize: 12 }}>{answered ? '可以下一题' : '请先回答这一题'}</span>
        <button type="button" className="btn btn-accent" onClick={onNext} disabled={pending || !answered}>
          {pending ? <><span className="ai-spinner" />&nbsp; 提交中</> : isLast ? `基于答案分析 →` : '下一题 →'}
        </button>
      </div>
    </div>
  );
}
