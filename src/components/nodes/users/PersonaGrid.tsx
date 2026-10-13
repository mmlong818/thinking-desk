'use client';

import { useState } from 'react';
import { EditableItemFields } from '@/components/shared/EditableItemFields';
import { ItemDecision, RejectionNote, StanceBadge } from '@/components/shared/ItemDecision';
import type { PersonaItem } from './users-meta';

const ROLE_LABEL = { accepted: '✓ 已选', pending: '待定', rejected: '已否决' } as const;

export function PersonaGrid({ personas }: { personas: PersonaItem[] }) {
  return (
    <div className="persona-grid">
      {personas.map((p) => <PersonaTile key={p.id} item={p} />)}
    </div>
  );
}

function PersonaTile({ item }: { item: PersonaItem }) {
  const [editing, setEditing] = useState(false);
  const p = item.body;
  const accepted = item.decision === 'accepted';
  return (
    <div className={`persona-tile ${accepted ? 'locked' : ''} ${item.decision === 'rejected' ? 'is-rejected' : ''}`}>
      <div className="persona-tile-top">
        <div className={`persona-tile-role ${accepted ? 'on' : ''}`}>{ROLE_LABEL[item.decision]}</div>
        <div className="persona-tile-name judged-text">{p.name}</div>
        <StanceBadge stance={item.aiStance} />
        <div className="persona-tile-actions">
          <ItemDecision item={item} onToggleEdit={() => setEditing((v) => !v)} editing={editing} showNote={false} />
        </div>
      </div>
      <div className="persona-tile-body">
        <div className="persona-tile-one-liner">{p.one_liner}</div>
        <div className="persona-tile-meta">{p.meta}</div>
        <div className="persona-tile-story">{p.story}</div>
        <div className="persona-tile-pain">{p.pain}</div>
        <RejectionNote item={item} />
        {editing ? <EditableItemFields item={item} /> : null}
      </div>
    </div>
  );
}
