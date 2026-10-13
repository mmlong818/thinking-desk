'use client';

import { useState } from 'react';
import { useItemActions } from '@/components/project/useItemActions';
import { EditableList, EditableText, EditableTextarea } from '@/components/shared/Editable';
import { ItemDecision, RejectionNote, StanceBadge } from '@/components/shared/ItemDecision';
import { judgedClass } from '@/components/shared/JudgeStrip';
import { LinkPicker } from '@/components/shared/LinkPicker';
import type { SubFeature } from '@/lib/ai/schemas/split-subfeatures';
import type { Link } from '@/lib/model/types';
import { linkedIds } from '@/lib/store/request-context';
import { LAYER_META, LAYER_OPTIONS, type SplitGroup, type SubtaskItem } from './split-meta';

export function FeatureSplitView({ group, links, titles, subtasks }: {
  group: SplitGroup;
  links: Link[];
  titles: Map<string, string>;
  /** Every live subtask of the node (dependency candidates). */
  subtasks: SubtaskItem[];
}) {
  const actions = useItemActions();
  const add = () =>
    void actions.create({
      node: 'split', type: 'subtask',
      body: { title: '', description: '', layer: 'mixed', estimate: '', acceptance_criteria: [], feature_name: group.name, critical: false },
      links: group.featureId ? [{ to: group.featureId, rel: 'implements' }] : [],
    });
  return (
    <div className="para-section">
      <div className="para-h">
        <span className="para-h-title">{group.name}</span>
        <span className="para-h-hint">{group.subtasks.length} 条子任务{group.moduleName ? ` · 模块 ${group.moduleName}` : ''}</span>
      </div>
      <div className="subfeature-list">
        {group.subtasks.map((st) => <SubtaskCard key={st.id} item={st} links={links} titles={titles} subtasks={subtasks} />)}
        <button type="button" className="btn btn-ghost subfeature-add" onClick={add}>+ 添加我的子任务</button>
        {actions.error ? <div className="idc-error">{actions.error}</div> : null}
      </div>
    </div>
  );
}

function SubtaskCard({ item, links, titles, subtasks }: {
  item: SubtaskItem;
  links: Link[];
  titles: Map<string, string>;
  subtasks: SubtaskItem[];
}) {
  const actions = useItemActions();
  const [editingDeps, setEditingDeps] = useState(false);
  const deps = linkedIds(links, item.id, 'depends_on').map((id) => titles.get(id) ?? id);
  const sf = item.body;
  const meta = LAYER_META[sf.layer];
  const patch = (p: Partial<typeof sf>) => void actions.editBody(item, { ...sf, ...p });
  return (
    <div className={`subfeature-card layer-${meta.cls} ${sf.critical ? 'critical' : ''} ${judgedClass(item)}`}>
      <div className="subfeature-head">
        <select
          className={`subfeature-layer subfeature-layer-select layer-${meta.cls}`}
          value={sf.layer}
          aria-label="子任务层"
          onChange={(e) => patch({ layer: e.target.value as SubFeature['layer'] })}
        >
          {LAYER_OPTIONS.map((l) => <option key={l} value={l}>{LAYER_META[l].label}</option>)}
        </select>
        <span className="subfeature-title judged-text"><b><EditableText value={sf.title} placeholder="子任务标题" onChange={(v) => patch({ title: v })} /></b></span>
        <span className="subfeature-est mono">⏱ <EditableText value={sf.estimate} placeholder="工作量" onChange={(v) => patch({ estimate: v })} /></span>
        {sf.critical ? <span className="subfeature-critical">关键路径</span> : null}
        <StanceBadge stance={item.aiStance} />
        <ItemDecision item={item} showNote={false} />
        {item.origin === 'human' ? (
          <button type="button" className="subfeature-remove" aria-label="删除这条子任务" title="删除" onClick={() => void actions.remove(item)}>×</button>
        ) : null}
      </div>
      <RejectionNote item={item} />
      <div className="subfeature-desc">
        <EditableTextarea value={sf.description} placeholder="子任务描述…" onChange={(v) => patch({ description: v })} />
      </div>
      <div className="subfeature-meta">
        <div>
          <b>验收：</b>
          <EditableList items={sf.acceptance_criteria} placeholder="验收标准…" addLabel="+ 添加验收标准" onChange={(next) => patch({ acceptance_criteria: next })} />
        </div>
        <div className="dim" style={{ fontSize: 12 }}>
          <b>依赖：</b>{deps.length > 0 ? deps.join(' · ') : '无'}
          <button type="button" className="link-edit-btn" onClick={() => setEditingDeps((v) => !v)} aria-expanded={editingDeps}>
            {editingDeps ? '完成' : '✎ 编辑依赖'}
          </button>
        </div>
      </div>
      {editingDeps ? (
        <LinkPicker
          from={item} rel="depends_on" links={links} title="这条子任务要等哪些子任务先完成？"
          candidates={subtasks.filter((s) => s.id !== item.id)}
          label={(s) => titles.get(s.id) || '（未命名子任务）'}
        />
      ) : null}
      {actions.error ? <div className="idc-error">{actions.error}</div> : null}
    </div>
  );
}
