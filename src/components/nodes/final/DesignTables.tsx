'use client';

import { EditableList, EditableText, EditableTextarea } from '@/components/shared/Editable';
import { judgedClass } from '@/components/shared/JudgeStrip';
import { EntryJudge } from './DesignParts';
import type { SectionOf } from './design-meta';
import type { DesignEdit } from './useDesignEdit';

export function Metrics({ items, edit }: { items: SectionOf<'metric'>[]; edit: DesignEdit }) {
  return (
    <div className="design-table-edit">
      <table className="design-metrics-table">
        <thead><tr><th>指标</th><th>定义</th><th>目标</th><th aria-label="操作" /></tr></thead>
        <tbody>
          {items.map((m) => (
            <tr key={m.id} className={judgedClass(m)}>
              <td><b><EditableText value={m.body.name} placeholder="指标名" onChange={(v) => edit.patch(m, { name: v })} /></b></td>
              <td><EditableText value={m.body.definition} placeholder="如何定义" onChange={(v) => edit.patch(m, { definition: v })} /></td>
              <td className="mono"><EditableText value={m.body.target} placeholder="目标值" onChange={(v) => edit.patch(m, { target: v })} /></td>
              <td><EntryJudge item={m} edit={edit} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="editable-add" onClick={() => edit.add('metric')}>+ 添加我的指标</button>
    </div>
  );
}

export function Risks({ items, edit }: { items: SectionOf<'risk'>[]; edit: DesignEdit }) {
  return (
    <div className="design-table-edit">
      <table className="design-metrics-table">
        <thead><tr><th>风险</th><th>缓解</th><th aria-label="操作" /></tr></thead>
        <tbody>
          {items.map((r) => (
            <tr key={r.id} className={judgedClass(r)}>
              <td><EditableTextarea value={r.body.risk} placeholder="一条风险…" onChange={(v) => edit.patch(r, { risk: v })} /></td>
              <td><EditableTextarea value={r.body.mitigation} placeholder="如何缓解…" onChange={(v) => edit.patch(r, { mitigation: v })} /></td>
              <td><EntryJudge item={r} edit={edit} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="editable-add" onClick={() => edit.add('risk')}>+ 添加我的风险</button>
    </div>
  );
}

export function Milestones({ items, edit }: { items: SectionOf<'milestone'>[]; edit: DesignEdit }) {
  return (
    <div className="design-milestones">
      {items.map((m) => (
        <div key={m.id} className={`design-milestone ${judgedClass(m)}`}>
          <div className="design-milestone-head">
            <b><EditableText value={m.body.phase} placeholder="阶段名" onChange={(v) => edit.patch(m, { phase: v })} /></b>
            <span className="dim">
              {' · '}
              <EditableText value={m.body.duration} placeholder="时长" onChange={(v) => edit.patch(m, { duration: v })} />
            </span>
            <span style={{ marginLeft: 'auto' }}><EntryJudge item={m} edit={edit} /></span>
          </div>
          <div>
            <EditableTextarea value={m.body.goal} placeholder="阶段目标…" onChange={(v) => edit.patch(m, { goal: v })} />
          </div>
          <EditableList
            items={m.body.deliverables}
            placeholder="一个交付物…"
            addLabel="+ 添加交付物"
            onChange={(next) => edit.patch(m, { deliverables: next })}
          />
        </div>
      ))}
      <button type="button" className="editable-add" onClick={() => edit.add('milestone')}>+ 添加我的里程碑</button>
    </div>
  );
}
