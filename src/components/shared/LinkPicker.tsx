'use client';

import { useItemActions } from '@/components/project/useItemActions';
import type { Item } from '@/lib/model/item-types';
import { createsCycle } from '@/lib/model/link-rules';
import type { Link, LinkRel } from '@/lib/model/types';

// Hand-editing one relation of one item: a checkbox per candidate target. Each toggle is one
// Repository.editLinks call (atomic, recorded as link_added / link_removed); the repository
// validates the pair against the type registry and refuses dependency cycles, and the picker
// disables the candidates that would close a cycle before the person even tries.

interface Props {
  from: Item;
  rel: LinkRel;
  candidates: readonly Item[];
  links: readonly Link[];
  label: (item: Item) => string;
  /** Heading above the checkboxes. */
  title: string;
  empty?: string;
}

export function LinkPicker({ from, rel, candidates, links, label, title, empty = '没有可选的条目' }: Props) {
  const actions = useItemActions();
  const current = new Map(links.filter((l) => l.from === from.id && l.rel === rel).map((l) => [l.to, l]));
  const busy = actions.busy !== null;
  const toggle = (to: Item) => {
    const existing = current.get(to.id);
    void actions.editLinks(existing ? { remove: [existing.id] } : { add: [{ from: from.id, to: to.id, rel }] });
  };
  return (
    <div className="link-picker">
      <div className="link-picker-title">{title}</div>
      {candidates.length === 0 ? <div className="dim">{empty}</div> : null}
      {candidates.map((c) => {
        const checked = current.has(c.id);
        const cycle = !checked && rel === 'depends_on' && createsCycle(links, from.id, c.id);
        return (
          <label key={c.id} className={`link-picker-row ${cycle ? 'blocked' : ''} ${c.decision === 'rejected' ? 'rejected' : ''}`}
            title={cycle ? '会形成循环依赖' : undefined}>
            <input type="checkbox" checked={checked} disabled={busy || cycle} onChange={() => toggle(c)} />
            <span>{label(c)}</span>
            {cycle ? <span className="link-picker-why">循环依赖</span> : null}
            {c.decision === 'rejected' ? <span className="link-picker-why">已否决</span> : null}
          </label>
        );
      })}
      {actions.error ? <div className="idc-error">{actions.error}</div> : null}
    </div>
  );
}
