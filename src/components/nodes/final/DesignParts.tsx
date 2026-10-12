'use client';

import type { ReactNode } from 'react';
import { EditableList, EditableText, EditableTextarea } from '@/components/shared/Editable';
import { ItemDecision } from '@/components/shared/ItemDecision';
import { judgedClass } from '@/components/shared/JudgeStrip';
import type { SectionItem, SectionOf } from './design-meta';
import type { DesignEdit } from './useDesignEdit';

/** ✓ / ✗ for an AI entry; a hand-made entry can also be deleted. */
export function EntryJudge({ item, edit }: { item: SectionItem; edit: DesignEdit }) {
  return (
    <span className="design-entry-judge">
      <ItemDecision item={item} />
      {item.origin === 'human' ? (
        <button type="button" className="editable-remove" style={{ opacity: 1 }} title="删除" onClick={() => edit.remove(item)}>×</button>
      ) : null}
    </span>
  );
}

export function DesignSection({ num, title, children }: { num: string; title: string; children: ReactNode }) {
  return (
    <div className="para-section">
      <div className="para-h">
        <span className="para-h-num">{num}</span>
        <span className="para-h-title">{title}</span>
      </div>
      {children}
    </div>
  );
}

export function DesignHeader({ overview, edit, onRegenerate, regenerating }: {
  overview: SectionOf<'overview'>;
  edit: DesignEdit;
  onRegenerate: () => void;
  regenerating: boolean;
}) {
  const b = overview.body;
  return (
    <div className="design-header">
      <div style={{ flex: 1 }}>
        <h2 className="design-title">
          <EditableText value={b.title} placeholder="设计案标题" onChange={(v) => edit.patch(overview, { title: v })} />
        </h2>
        <div className="design-oneliner">
          <EditableText value={b.one_liner} placeholder="一句话定义这个设计…" onChange={(v) => edit.patch(overview, { one_liner: v })} />
        </div>
        <div className="design-vision">
          <EditableTextarea value={b.vision} placeholder="愿景…" onChange={(v) => edit.patch(overview, { vision: v })} />
        </div>
        <ItemDecision item={overview} variant="full" />
      </div>
      <button type="button" className="btn btn-ghost" onClick={onRegenerate} disabled={regenerating}>
        {regenerating ? '重新生成中…' : '重新生成'}
      </button>
    </div>
  );
}

export function Principles({ item, edit }: { item: SectionOf<'principles'>; edit: DesignEdit }) {
  return (
    <div className={judgedClass(item)}>
      <EditableList
        items={item.body.items}
        placeholder="一条设计原则…"
        addLabel="+ 添加我的设计原则"
        onChange={(next) => edit.patch(item, { items: next })}
      />
      <ItemDecision item={item} />
    </div>
  );
}

/** Information architecture / key interactions / tech skeleton: titled text cards. */
export function SectionCards({ items, edit }: { items: SectionOf<'ia' | 'interaction' | 'tech'>[]; edit: DesignEdit }) {
  return (
    <div className="design-sections">
      {items.map((s) => (
        <div key={s.id} className={`design-section-card ${judgedClass(s)}`}>
          <div className="design-section-title">
            <b><EditableText value={s.body.title} placeholder="标题" onChange={(v) => edit.patch(s, { title: v })} /></b>
            <EntryJudge item={s} edit={edit} />
          </div>
          <div className="design-section-body">
            <EditableTextarea value={s.body.body} placeholder="说明…" onChange={(v) => edit.patch(s, { body: v })} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function OpenQuestions({ items, edit }: { items: SectionOf<'open_question'>[]; edit: DesignEdit }) {
  return (
    <ul className="editable-list">
      {items.map((q) => (
        <li key={q.id} className={`editable-list-item ${judgedClass(q)}`}>
          <EditableText value={q.body.text} placeholder="一个还没拿定主意的问题…" onChange={(v) => edit.patch(q, { text: v })} />
          <EntryJudge item={q} edit={edit} />
        </li>
      ))}
      <li className="editable-list-add">
        <button type="button" className="editable-add" onClick={() => edit.add('open_question')}>+ 添加我的待决策</button>
      </li>
    </ul>
  );
}
