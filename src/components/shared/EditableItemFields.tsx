'use client';

import type { Item } from '@/lib/model/item-types';
import { useItemActions } from '@/components/project/useItemActions';
import { EditableText, EditableTextarea } from './Editable';
import { ITEM_EDIT_FIELDS } from './item-labels';

/**
 * In-place editor for an item's free-text fields (the "✎ 编辑" of the decision control).
 * A human edit bumps the version and marks an AI item `ai_edited`; the decision is unchanged.
 */
export function EditableItemFields({ item }: { item: Item }) {
  const actions = useItemActions();
  const fields = ITEM_EDIT_FIELDS[item.type] ?? [];
  const body = item.body as Record<string, unknown>;
  const save = (key: string, value: string) => void actions.editBody(item, { ...body, [key]: value });
  return (
    <div className="item-fields">
      {fields.map((f) => {
        const value = typeof body[f.key] === 'string' ? (body[f.key] as string) : '';
        return (
          <div key={f.key} className="item-field">
            <span className="item-field-label">{f.label}</span>
            {f.long ? (
              <EditableTextarea value={value} placeholder="点击补充…" onChange={(v) => save(f.key, v)} />
            ) : (
              <EditableText value={value} placeholder="点击补充…" onChange={(v) => save(f.key, v)} />
            )}
          </div>
        );
      })}
      {actions.error ? <div className="idc-error">{actions.error}</div> : null}
    </div>
  );
}
