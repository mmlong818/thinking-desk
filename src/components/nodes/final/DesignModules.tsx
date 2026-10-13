'use client';

import { useState } from 'react';
import { useItemActions } from '@/components/project/useItemActions';
import { EditableText, EditableTextarea } from '@/components/shared/Editable';
import { ItemDecision, StanceBadge } from '@/components/shared/ItemDecision';
import { judgedClass } from '@/components/shared/JudgeStrip';
import { LinkPicker } from '@/components/shared/LinkPicker';
import type { Item } from '@/lib/model/item-types';
import type { Link } from '@/lib/model/types';
import { linkedIds } from '@/lib/store/request-context';
import type { ModuleItem } from './design-meta';

const nameOf = (i: Item) => {
  const b = i.body as { name?: unknown };
  return typeof b.name === 'string' ? b.name : i.id;
};

interface ModulesProps {
  modules: ModuleItem[];
  links: Link[];
  byId: Map<string, Item>;
  /** The design's feature list (node `final`): what a module can implement. */
  features: Item[];
}

/** Modules; the features they implement and the modules they depend on are their Links. */
export function Modules({ modules, links, byId, features }: ModulesProps) {
  return (
    <div className="design-modules">
      {modules.map((m) => <ModuleCard key={m.id} module={m} links={links} byId={byId} features={features} />)}
    </div>
  );
}

function ModuleCard({ module: m, links, byId, features }: Omit<ModulesProps, 'modules'> & { module: ModuleItem }) {
  const actions = useItemActions();
  const [editing, setEditing] = useState(false);
  const names = (ids: string[]) => ids.map((id) => byId.get(id)).filter((i): i is Item => !!i).map(nameOf);
  const linked = names(linkedIds(links, m.id, 'implements'));
  const deps = names(linkedIds(links, m.id, 'depends_on'));
  return (
    <div className={`design-module-card ${judgedClass(m)}`}>
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
        <div>
          <b>关联功能：</b>{linked.join(', ') || '—'}
          <button type="button" className="link-edit-btn" onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            {editing ? '完成' : '✎ 编辑关联'}
          </button>
        </div>
        {editing ? (
          <LinkPicker from={m} rel="implements" links={links} candidates={features} label={nameOf}
            title="这个模块实现哪些功能？" empty="设计案还没有功能列表" />
        ) : null}
        <div><b>主要屏幕：</b>{m.body.key_screens.join(' · ') || '—'}</div>
        {deps.length > 0 ? <div><b>依赖：</b>{deps.join(' · ')}</div> : null}
      </div>
      {actions.error ? <div className="idc-error">{actions.error}</div> : null}
    </div>
  );
}
