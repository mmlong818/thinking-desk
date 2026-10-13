'use client';

import { EditableText } from '@/components/shared/Editable';
import { judgedClass } from '@/components/shared/JudgeStrip';
import { EntryJudge } from './DesignParts';
import type { SectionOf } from './design-meta';
import type { DesignEdit } from './useDesignEdit';

type Flow = SectionOf<'flow'>;
type Step = Flow['body']['steps'][number];
type Entity = SectionOf<'data_entity'>;
type Field = Entity['body']['fields'][number];

/** A user flow keeps at least two steps (the flow schema's minimum). */
const MIN_STEPS = 2;

export function UserFlows({ items, edit }: { items: Flow[]; edit: DesignEdit }) {
  return (
    <>
      {items.map((f) => <FlowCard key={f.id} flow={f} edit={edit} />)}
      <button type="button" className="editable-add" onClick={() => edit.add('flow')}>+ 添加我的用户流</button>
    </>
  );
}

function FlowCard({ flow: f, edit }: { flow: Flow; edit: DesignEdit }) {
  const b = f.body;
  const setSteps = (steps: Step[]) => edit.patch(f, { steps: steps.map((s, j) => ({ ...s, step: j + 1 })) });
  const patchStep = (si: number, mut: Partial<Step>) => setSteps(b.steps.map((s, j) => (j === si ? { ...s, ...mut } : s)));
  return (
    <div className={`design-flow ${judgedClass(f)}`}>
      <div className="design-flow-head">
        <b><EditableText value={b.name} placeholder="用户流名" onChange={(v) => edit.patch(f, { name: v })} /></b>
        <span className="dim">{' · '}<EditableText value={b.goal} placeholder="目标" onChange={(v) => edit.patch(f, { goal: v })} /></span>
        <span style={{ marginLeft: 'auto' }}><EntryJudge item={f} edit={edit} /></span>
      </div>
      <div className="design-flow-pre">
        <b>前置：</b>
        <EditableText value={b.precondition} placeholder="前置条件…" onChange={(v) => edit.patch(f, { precondition: v })} />
      </div>
      <ol className="design-flow-steps">
        {b.steps.map((s, si) => (
          <li key={si} className="design-flow-step-row">
            <div className="design-flow-step-line">
              <b><EditableText value={s.actor} placeholder="谁" onChange={(v) => patchStep(si, { actor: v })} /></b>
              <span>：</span>
              <EditableText value={s.action} placeholder="做什么" onChange={(v) => patchStep(si, { action: v })} />
              {b.steps.length > MIN_STEPS ? (
                <button type="button" className="editable-remove" title="删除这一步" onClick={() => setSteps(b.steps.filter((_, j) => j !== si))}>×</button>
              ) : null}
            </div>
            <div className="design-flow-resp">
              → <EditableText value={s.system_response} placeholder="系统响应…" onChange={(v) => patchStep(si, { system_response: v })} />
            </div>
          </li>
        ))}
        <li>
          <button type="button" className="editable-add" onClick={() => setSteps([...b.steps, { step: 0, actor: '', action: '', system_response: '' }])}>
            + 添加一步
          </button>
        </li>
      </ol>
      <div className="design-flow-foot">
        <span><b>成功：</b><EditableText value={b.success_criteria} placeholder="怎么算成功…" onChange={(v) => edit.patch(f, { success_criteria: v })} /></span>
        <span><b>失败处理：</b><EditableText value={b.failure_handling} placeholder="失败时…" onChange={(v) => edit.patch(f, { failure_handling: v })} /></span>
      </div>
    </div>
  );
}

export function DataModel({ items, edit }: { items: Entity[]; edit: DesignEdit }) {
  return (
    <div className="design-entities">
      {items.map((e) => <EntityCard key={e.id} entity={e} edit={edit} />)}
      <button type="button" className="editable-add" onClick={() => edit.add('data_entity')}>+ 添加我的实体</button>
    </div>
  );
}

function EntityCard({ entity: e, edit }: { entity: Entity; edit: DesignEdit }) {
  const fields = e.body.fields;
  const setFields = (next: Field[]) => edit.patch(e, { fields: next });
  const patchField = (fi: number, mut: Partial<Field>) => setFields(fields.map((f, j) => (j === fi ? { ...f, ...mut } : f)));
  return (
    <div className={`design-entity ${judgedClass(e)}`}>
      <div className="design-entity-head">
        <b><EditableText value={e.body.name} placeholder="实体名" onChange={(v) => edit.patch(e, { name: v })} /></b>
        <span className="dim">{' · '}<EditableText value={e.body.description} placeholder="实体说明…" onChange={(v) => edit.patch(e, { description: v })} /></span>
        <span style={{ marginLeft: 'auto' }}><EntryJudge item={e} edit={edit} /></span>
      </div>
      <table className="design-entity-table">
        <thead><tr><th>字段</th><th>类型</th><th>说明</th><th aria-label="操作" /></tr></thead>
        <tbody>
          {fields.map((f, fi) => (
            <tr key={fi}>
              <td className="mono"><EditableText value={f.name} placeholder="field_name" onChange={(v) => patchField(fi, { name: v })} /></td>
              <td className="mono dim"><EditableText value={f.type} placeholder="string / int…" onChange={(v) => patchField(fi, { type: v })} /></td>
              <td><EditableText value={f.note} placeholder="说明" onChange={(v) => patchField(fi, { note: v })} /></td>
              <td><button type="button" className="editable-remove" title="删除字段" onClick={() => setFields(fields.filter((_, j) => j !== fi))}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="editable-add" onClick={() => setFields([...fields, { name: '', type: '', note: '' }])}>+ 添加字段</button>
    </div>
  );
}
