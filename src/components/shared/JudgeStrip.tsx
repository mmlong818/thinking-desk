'use client';

import { useState } from 'react';
import type { Item } from '@/lib/model/item-types';
import { EditableItemFields } from './EditableItemFields';
import { ITEM_EDIT_FIELDS } from './item-labels';
import { ItemDecision, RejectionNote, StanceBadge } from './ItemDecision';

/** Card modifier for the item's decision ('is-accepted' / 'is-rejected' / ''). */
export function judgedClass(item: Item): string {
  if (item.decision === 'accepted') return 'is-accepted';
  return item.decision === 'rejected' ? 'is-rejected' : '';
}

/**
 * The judging row a content card ends with: AI stance, accept / reject / edit, the rejection
 * note and — when editing — the item's free-text fields.
 */
export function JudgeStrip({ item, guardAccept }: { item: Item; guardAccept?: () => string | null }) {
  const [editing, setEditing] = useState(false);
  const editable = (ITEM_EDIT_FIELDS[item.type] ?? []).length > 0;
  return (
    <>
      <div className="judge-strip">
        <StanceBadge stance={item.aiStance} />
        <ItemDecision
          item={item}
          showNote={false}
          guardAccept={guardAccept}
          onToggleEdit={editable ? () => setEditing((v) => !v) : undefined}
          editing={editing}
        />
      </div>
      <RejectionNote item={item} />
      {editing ? <EditableItemFields item={item} /> : null}
    </>
  );
}
