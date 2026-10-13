'use client';

import type { ItemOfType } from '@/lib/model/context';
import { BRIEF_COMPLETENESS_THRESHOLD } from '@/lib/model/adapters';
import { EditableList, EditableText, EditableTextarea } from '@/components/shared/Editable';
import { ItemDecision } from '@/components/shared/ItemDecision';
import { JudgeBar } from '@/components/shared/JudgeBar';
import { ContinueButton } from '@/components/shared/Navigation';
import { ParaHead } from '@/components/shared/NodeKit';
import { FIELD_META, LONG_FIELDS, SCALAR_FIELDS } from './brief-meta';
import { AssumptionList, RedLineList } from './BriefLists';
import type { useBriefEditing } from './useBriefEditing';

type BriefItem = ItemOfType<'brief'>;
type Editing = ReturnType<typeof useBriefEditing>;

interface Props {
  brief: BriefItem;
  redLines: ItemOfType<'red_line'>[];
  assumptions: ItemOfType<'assumption'>[];
  editing: Editing;
  onReset: () => void;
}

export function BriefDone({ brief, redLines, assumptions, editing, onReset }: Props) {
  const { answers, fields } = brief.body;
  return (
    <>
      <JudgeBar node="brief" judged={['brief', 'red_line', 'assumption']} />
      {answers.length > 0 ? <AnswersSection answers={answers} /> : null}
      <div className="para-section">
        <ParaHead title="结构化 Brief" hint="AI 已填 · 点任意字段可改" />
        <div style={{ marginBottom: 10 }}><ItemDecision item={brief} variant="full" /></div>
        <StructuredFields brief={brief} editing={editing} />
      </div>
      <CompletenessSection completeness={brief.body.completeness} />
      <div className="para-section">
        <ParaHead title="明确不做的事" hint="本次能力边界之外" />
        <EditableList
          items={fields.boundaries}
          placeholder="一条边界…"
          addLabel="+ 添加我的边界"
          onChange={(next) => editing.patchFields({ boundaries: next.filter((b) => b.trim()) })}
        />
      </div>
      <RedLinesSection redLines={redLines} onAdd={editing.addRedLine} />
      {assumptions.length > 0 ? (
        <div className="para-section">
          <ParaHead title="待验证的假设" hint="从原文识别 · 采纳表示认同它是需要验证的前提" />
          <AssumptionList items={assumptions} />
        </div>
      ) : null}
      {editing.error ? <div className="idc-error">{editing.error}</div> : null}
      <div className="para-section">
        <button type="button" className="btn btn-ghost" onClick={onReset}>重新粘贴 / 重新分析</button>
      </div>
    </>
  );
}

function AnswersSection({ answers }: { answers: BriefItem['body']['answers'] }) {
  return (
    <div className="para-section">
      <ParaHead title="澄清回答" hint={`${answers.length} 条 · 已作为事实进入 Brief`} />
      <div className="brief-form">
        {answers.map((a, i) => (
          <div className="brief-row" key={i}>
            <div className="brief-label">{a.question}</div>
            <div className="brief-value">
              <span className="ai-filled">{Array.isArray(a.answer) ? a.answer.join(' · ') : a.answer}</span>
            </div>
            <div className="brief-status filled">✓</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StructuredFields({ brief, editing }: { brief: BriefItem; editing: Editing }) {
  // boundaries / red lines are edited in their own sections below.
  return (
    <div className="brief-form">
      {SCALAR_FIELDS.map((key) => {
        const meta = FIELD_META[key];
        const v = brief.body.fields[key];
        const empty = v == null || v.trim() === '';
        const Editor = LONG_FIELDS.has(key) ? EditableTextarea : EditableText;
        return (
          <div className="brief-row" key={key}>
            <div className="brief-label">{meta.label}<small>{meta.sub}</small></div>
            <div className="brief-value">
              <Editor
                value={v ?? ''}
                placeholder="未定义 · 点击补充"
                onChange={(next) => editing.patchFields({ [key]: next === '' ? null : next })}
              />
            </div>
            <div className={`brief-status ${empty ? 'empty' : 'filled'}`}>{empty ? '' : '✓'}</div>
          </div>
        );
      })}
    </div>
  );
}

function CompletenessSection({ completeness }: { completeness: number }) {
  const reached = completeness >= BRIEF_COMPLETENESS_THRESHOLD;
  return (
    <div className="para-section">
      <ParaHead title="完整度" hint="70% 以上可进入下一节点" />
      <div className="completeness-bar">
        <span className="completeness-num">
          {completeness}
          <span style={{ fontSize: 14, color: 'var(--ink-4)' }}>%</span>
        </span>
        <div style={{ flex: 1 }}>
          <div className="bar"><div style={{ width: `${completeness}%` }} /></div>
          <div className="completeness-note" style={{ marginTop: 8 }}>
            {reached
              ? <><b>已达阈值</b> —— 可以进入下一节点，剩余项可稍后补充。</>
              : <><b>还差 {BRIEF_COMPLETENESS_THRESHOLD - completeness} 个百分点</b> —— 右侧的追问逐个回答即可。</>}
          </div>
        </div>
        <ContinueButton node="brief" label="继续 → 02 用户与任务" />
      </div>
    </div>
  );
}

function RedLinesSection({ redLines, onAdd }: { redLines: ItemOfType<'red_line'>[]; onAdd: (text: string) => void }) {
  const live = redLines.filter((r) => r.decision !== 'rejected');
  return (
    <div className="para-section">
      <ParaHead title="道德红线" hint="方法论 §4.1 硬性要求 · 无论商业诱惑多大都不做" />
      {live.length === 0 ? (
        <div className="red-line-empty" style={{ marginBottom: 10 }}>
          <b>⚠ 尚未定义道德红线。</b>
          建议手动补上 2-3 条——这会在后续每个节点的伦理审查里被反复引用。
          举例：<em>不收集未成年人生物信息 · 不默认开启付费订阅 · 不使用情绪操纵式推送</em>
        </div>
      ) : null}
      <RedLineList items={redLines} onAdd={onAdd} />
    </div>
  );
}
