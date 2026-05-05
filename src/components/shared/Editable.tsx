'use client';

import { useEffect, useRef, useState } from 'react';

interface BaseProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}

/**
 * 单行可编辑文本：默认是只读的 span，点击 → input；blur / Enter 写回。
 * Esc 放弃改动。
 */
export function EditableText({ value, onChange, placeholder, className, ariaLabel }: BaseProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className={`editable editable-input ${className ?? ''}`}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            commit();
          } else if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <span
      className={`editable ${value ? '' : 'editable-empty'} ${className ?? ''}`}
      role="button"
      tabIndex={0}
      title="点击编辑"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setDraft(value);
          setEditing(true);
        }
      }}
    >
      {value || placeholder || '点击编辑…'}
    </span>
  );
}

/**
 * 多行可编辑文本：点击 → textarea；blur 写回。
 * 不绑 Enter 提交（多行可能要换行）。Esc 放弃。
 */
export function EditableTextarea({ value, onChange, placeholder, className, ariaLabel }: BaseProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const taRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && taRef.current) {
      taRef.current.focus();
      const len = taRef.current.value.length;
      taRef.current.setSelectionRange(len, len);
      taRef.current.style.height = 'auto';
      taRef.current.style.height = taRef.current.scrollHeight + 'px';
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    if (draft !== value) onChange(draft);
  };

  if (editing) {
    return (
      <textarea
        ref={taRef}
        className={`editable editable-textarea ${className ?? ''}`}
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        onChange={(e) => {
          setDraft(e.target.value);
          e.currentTarget.style.height = 'auto';
          e.currentTarget.style.height = e.currentTarget.scrollHeight + 'px';
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setDraft(value);
            setEditing(false);
          }
        }}
      />
    );
  }

  return (
    <div
      className={`editable editable-block ${value ? '' : 'editable-empty'} ${className ?? ''}`}
      role="button"
      tabIndex={0}
      title="点击编辑"
      onClick={() => {
        setDraft(value);
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          setDraft(value);
          setEditing(true);
        }
      }}
    >
      {value || placeholder || '点击编辑…'}
    </div>
  );
}

/**
 * 字符串数组可编辑（每条单独一行 + 行末 × 删除 + 末尾 + 添加）。
 */
export function EditableList({
  items,
  onChange,
  placeholder,
  addLabel,
}: {
  items: readonly string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  addLabel?: string;
}) {
  return (
    <ul className="editable-list">
      {items.map((it, i) => (
        <li key={i} className="editable-list-item">
          <EditableText
            value={it}
            placeholder={placeholder}
            onChange={(v) => {
              const next = [...items];
              if (v.trim() === '') next.splice(i, 1);
              else next[i] = v;
              onChange(next);
            }}
          />
          <button
            type="button"
            className="editable-remove"
            aria-label="删除这一条"
            title="删除"
            onClick={() => {
              const next = [...items];
              next.splice(i, 1);
              onChange(next);
            }}
          >
            ×
          </button>
        </li>
      ))}
      <li className="editable-list-add">
        <button type="button" className="editable-add" onClick={() => onChange([...items, ''])}>
          {addLabel ?? '+ 添加一条'}
        </button>
      </li>
    </ul>
  );
}
