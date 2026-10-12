'use client';

import { useState } from 'react';
import type { ItemOfType } from '@/lib/model/context';
import { useItemActions } from '@/components/project/useItemActions';
import { EditableText } from '@/components/shared/Editable';
import { ItemDecision, StanceBadge } from '@/components/shared/ItemDecision';

/** Red lines are items: each one judged on its own; text editable in place; new ones are the person's. */
export function RedLineList({ items, onAdd }: { items: ItemOfType<'red_line'>[]; onAdd: (text: string) => void }) {
  const actions = useItemActions();
  return (
    <ul className="editable-list">
      {items.map((r) => (
        <li key={r.id} className={`editable-list-item ${r.decision === 'rejected' ? 'is-rejected' : ''}`}>
          <span className="judged-text" style={{ flex: 1 }}>
            <EditableText
              value={r.body.text}
              placeholder="一条红线…"
              onChange={(v) => (v.trim() ? void actions.editBody(r, { text: v.trim() }) : void actions.reject(r))}
            />
          </span>
          <StanceBadge stance={r.aiStance} />
          <ItemDecision item={r} />
        </li>
      ))}
      <li className="editable-list-add">
        <AddLine label="+ 添加我的红线" placeholder="一条红线…" onAdd={onAdd} />
      </li>
      {actions.error ? <li className="idc-error">{actions.error}</li> : null}
    </ul>
  );
}

function AddLine({ label, placeholder, onAdd }: { label: string; placeholder: string; onAdd: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const commit = () => {
    if (text.trim()) onAdd(text);
    setText('');
    setOpen(false);
  };
  if (!open) {
    return <button type="button" className="editable-add" onClick={() => setOpen(true)}>{label}</button>;
  }
  return (
    <input
      autoFocus
      className="editable editable-input"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commit();
        if (e.key === 'Escape') setOpen(false);
      }}
    />
  );
}

/** Assumptions the extraction spotted in the raw text (they used to be highlights only). */
export function AssumptionList({ items }: { items: ItemOfType<'assumption'>[] }) {
  return (
    <div className="brief-form">
      {items.map((a) => (
        <div key={a.id} className={`brief-row ${a.decision === 'rejected' ? 'is-rejected' : ''}`}>
          <div className="brief-label">
            <span className="hl hl-assume">假设</span>
          </div>
          <div className="brief-value">
            <div className="judged-text">{a.body.statement}</div>
            {a.body.rationale ? <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{a.body.rationale}</div> : null}
          </div>
          <ItemDecision item={a} />
        </div>
      ))}
    </div>
  );
}
