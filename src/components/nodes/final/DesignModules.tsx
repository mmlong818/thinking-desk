'use client';

import { useItemActions } from '@/components/project/useItemActions';
import { EditableText, EditableTextarea } from '@/components/shared/Editable';
import { ItemDecision, StanceBadge } from '@/components/shared/ItemDecision';
import { judgedClass } from '@/components/shared/JudgeStrip';
import type { Item } from '@/lib/model/item-types';
import type { Link } from '@/lib/model/types';
import { linkedIds } from '@/lib/store/request-context';
import type { ModuleItem } from './design-meta';

const nameOf = (i: Item) => {
  const b = i.body as { name?: unknown };
  return typeof b.name === 'string' ? b.name : i.id;
};

/** Modules; the features they implement and the modules they depend on are their Links. */
export function Modules({ modules, links, byId }: { modules: ModuleItem[]; links: Link[]; byId: Map<string, Item> }) {
  const actions = useItemActions();
  const names = (ids: string[]) => ids.map((id) => byId.get(id)).filter((i): i is Item => !!i).map(nameOf);
  return (
    <div className="design-modules">
      {modules.map((m) => {
        const features = names(linkedIds(links, m.id, 'implements'));
        const deps = names(linkedIds(links, m.id, 'depends_on'));
        return (
          <div key={m.id} className={`design-module-card ${judgedClass(m)}`}>
            <div className="design-module-head">
              <span className="design-module-name">
                <EditableText value={m.body.name} placeholder="模块名" onChange={(v) => void actions.editBody(m, { ...m.body, name: v })} />
              </span>
              <StanceBadge stance={m.aiStance} />
              <ItemDecision item={m} />
            </div>
            <div className="design-module-body">
              <EditableTextarea value={m.body.responsibility} placeholder="模块职责…" onChange={(v) => void actions.editBody(m, { ...m.body, responsibility: v })} />
            </div>
            <div className="design-module-meta">
              <div><b>关联功能：</b>{features.join(', ') || '—'}</div>
              <div><b>主要屏幕：</b>{m.body.key_screens.join(' · ') || '—'}</div>
              {deps.length > 0 ? <div><b>依赖：</b>{deps.join(' · ')}</div> : null}
            </div>
          </div>
        );
      })}
      {actions.error ? <div className="idc-error">{actions.error}</div> : null}
    </div>
  );
}
