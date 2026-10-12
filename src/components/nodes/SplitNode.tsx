'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { NodeFollowUpsSection } from '@/components/shared/NodeFollowUpsSection';
import { EditableText, EditableTextarea, EditableList } from '@/components/shared/Editable';
import type { DesignProposal } from '@/lib/ai/schemas/generate-design';
import type { SubfeatureBreakdown, SubFeature, FeatureSplit } from '@/lib/ai/schemas/split-subfeatures';
import { readCache, writeCache } from '@/lib/client-cache';
import { readPreferredModel } from '@/lib/client-model';
import { formatNodeNum } from '@/data/nodes';

const LAYER_OPTIONS: SubFeature['layer'][] = ['frontend', 'backend', 'data', 'ai', 'design', 'test', 'devops', 'mixed'];

interface Props {
  projectSlug: string;
  initial?: SubfeatureBreakdown;
  designContent?: DesignProposal | null;
}

const LAYER_META: Record<SubFeature['layer'], { label: string; cls: string }> = {
  frontend: { label: '前端', cls: 'fe' },
  backend:  { label: '后端', cls: 'be' },
  data:     { label: '数据', cls: 'data' },
  ai:       { label: 'AI',  cls: 'ai' },
  design:   { label: '设计', cls: 'design' },
  test:     { label: '测试', cls: 'test' },
  devops:   { label: '运维', cls: 'devops' },
  mixed:    { label: '综合', cls: 'mixed' },
};

export function SplitNode({ projectSlug, initial, designContent }: Props) {
  const [data, setData] = useState<SubfeatureBreakdown | null>(initial ?? null);
  const [design, setDesign] = useState<DesignProposal | null>(designContent ?? null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();

  useEffect(() => {
    if (!data) {
      const c = readCache<SubfeatureBreakdown>(projectSlug, 'split');
      if (c) setData(c);
    }
    if (!design) {
      const d = readCache<DesignProposal>(projectSlug, 'design');
      if (d) setDesign(d);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  const update = (next: SubfeatureBreakdown) => {
    setData(next);
    writeCache(projectSlug, 'split', next);
  };

  const updateSubfeature = (featureIdx: number, subIdx: number, patch: Partial<SubFeature>) => {
    if (!data) return;
    const splits = data.splits.map((s, i) =>
      i !== featureIdx ? s : {
        ...s,
        subfeatures: s.subfeatures.map((sf, j) => (j !== subIdx ? sf : { ...sf, ...patch })),
      },
    );
    update({ ...data, splits });
  };

  const removeSubfeature = (featureIdx: number, subIdx: number) => {
    if (!data) return;
    const splits = data.splits.map((s, i) =>
      i !== featureIdx ? s : { ...s, subfeatures: s.subfeatures.filter((_, j) => j !== subIdx) },
    );
    const total = splits.reduce((acc, s) => acc + s.subfeatures.length, 0);
    update({ ...data, splits, total_subfeatures: total });
  };

  const addSubfeature = (featureIdx: number) => {
    if (!data) return;
    const featureSplit = data.splits[featureIdx];
    if (!featureSplit) return;
    const newId = `${featureSplit.feature_id}-sf${featureSplit.subfeatures.length + 1}-${Date.now().toString(36).slice(-3)}`;
    const fresh: SubFeature = {
      id: newId,
      title: '',
      description: '',
      layer: 'mixed',
      estimate: '',
      acceptance_criteria: [],
      dependencies: [],
    };
    const splits = data.splits.map((s, i) =>
      i !== featureIdx ? s : { ...s, subfeatures: [...s.subfeatures, fresh] },
    );
    update({ ...data, splits, total_subfeatures: data.total_subfeatures + 1 });
  };

  const updateSummary = (summary: string) => {
    if (!data) return;
    update({ ...data, summary });
  };

  const run = () => {
    setError(null);
    setRunning(true);
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = { projectSlug };
        const preferred = readPreferredModel();
        if (preferred) payload.model = preferred;
        if (design) payload.design = design;

        const res = await fetch('/api/ai/split-subfeatures', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as { ok?: boolean; data?: SubfeatureBreakdown; error?: string; detail?: string };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '拆分失败');
        }
        setData(json.data);
        writeCache(projectSlug, 'split', json.data);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(false);
      }
    });
  };

  const cards = useMemo<CopilotCard[]>(() => {
    if (!design) {
      return [{
        tag: 'check',
        title: '需要先完成 08 设计案',
        body: <>请回到 <Link href={`/project/${projectSlug}/final`} style={{ color: 'var(--accent)' }}>08 设计案</Link> 节点生成完整设计后再来。</>,
      }];
    }
    if (!data) {
      return [{
        tag: 'feed',
        title: '点"拆分子任务"',
        body: '我会把每个 feature → 2-6 条可执行子任务（前端/后端/数据/AI 标签 + 工作量估计 + 验收标准）。',
      }];
    }
    return [
      { tag: 'feed', title: `共 ${data.total_subfeatures} 条子任务`, body: data.summary },
      data.critical_path.length > 0
        ? { tag: 'check', title: `关键路径（${data.critical_path.length}）`, body: data.critical_path.join(' → ') }
        : null,
    ].filter(Boolean) as CopilotCard[];
  }, [data, design, projectSlug]);

  if (!design) {
    return (
      <div className="main">
        <main className="work">
          <div className="work-inner">
            <NodeHat />
            <h1 className="node-title">子功能拆分：从设计 → 可执行任务</h1>
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-state-title">尚无设计案</div>
              <p>请先完成 <Link href={`/project/${projectSlug}/final`} style={{ color: 'var(--accent)' }}>08 设计案</Link> 节点。</p>
            </div>
          </div>
        </main>
        <Copilot projectSlug={projectSlug} nodeKind="split" cards={cards} />
      </div>
    );
  }

  return (
    <div className="main">
      <main className="work wide">
        <div className="work-inner">
          <NodeHat />
          <h1 className="node-title">子功能拆分：从设计 → 可执行任务</h1>
          <p className="node-intro">
            把 08 设计案里的每个 feature → 立刻能开 ticket 的子任务。每条带 layer 标签、工作量估计、验收标准。
          </p>

          {!data ? (
            <div className="para-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div className="dim" style={{ fontSize: 13 }}>
                输入：{design.modules.length} 模块 · {design.modules.reduce((acc, m) => acc + m.feature_ids.length, 0)} 功能
              </div>
              <button type="button" className="btn btn-accent" onClick={run} disabled={running}>
                {running ? <><span className="ai-spinner" /> &nbsp;拆分中… 通常 60-120 秒</> : '拆分子任务 →'}
              </button>
            </div>
          ) : (
            <BreakdownView
              data={data}
              onRerun={run}
              rerunning={running}
              onUpdateSubfeature={updateSubfeature}
              onRemoveSubfeature={removeSubfeature}
              onAddSubfeature={addSubfeature}
              onUpdateSummary={updateSummary}
            />
          )}

          {error ? (
            <div className="cop-card" style={{ marginTop: 14, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
              <div className="cop-card-title">调用失败</div>
              <div className="cop-card-body" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{error}</div>
            </div>
          ) : null}
        </div>
      </main>
      <Copilot projectSlug={projectSlug} nodeKind="split" cards={cards} pending={running}
        extraSlot={data ? <NodeFollowUpsSection projectSlug={projectSlug} nodeKind="split" content={data as unknown as Record<string, unknown>} /> : null}
      />
    </div>
  );
}

function NodeHat() {
  return (
    <div className="node-hat">
      <span className="node-hat-num">{formatNodeNum('split')}</span>
      <span className="node-hat-rule" />
      <span className="node-hat-chip">子功能拆分 · 可执行任务</span>
    </div>
  );
}

interface BreakdownProps {
  data: SubfeatureBreakdown;
  onRerun: () => void;
  rerunning: boolean;
  onUpdateSubfeature: (featureIdx: number, subIdx: number, patch: Partial<SubFeature>) => void;
  onRemoveSubfeature: (featureIdx: number, subIdx: number) => void;
  onAddSubfeature: (featureIdx: number) => void;
  onUpdateSummary: (summary: string) => void;
}

function BreakdownView({
  data,
  onRerun,
  rerunning,
  onUpdateSubfeature,
  onRemoveSubfeature,
  onAddSubfeature,
  onUpdateSummary,
}: BreakdownProps) {
  const criticalSet = new Set(data.critical_path);
  return (
    <>
      <div className="design-header">
        <div style={{ flex: 1 }}>
          <div className="design-oneliner">
            <EditableText value={data.summary} onChange={onUpdateSummary} placeholder="一句话总结…" />
          </div>
          <div className="dim" style={{ marginTop: 4, fontSize: 12 }}>
            {data.splits.length} 个 feature · {data.total_subfeatures} 条子任务 · 关键路径 {data.critical_path.length} 条
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onRerun} disabled={rerunning}>
          {rerunning ? '重新生成中…' : '重新拆分'}
        </button>
      </div>

      {data.splits.map((s, fi) => (
        <FeatureSplitView
          key={s.feature_id}
          featureSplit={s}
          featureIdx={fi}
          criticalSet={criticalSet}
          onUpdateSubfeature={onUpdateSubfeature}
          onRemoveSubfeature={onRemoveSubfeature}
          onAddSubfeature={onAddSubfeature}
        />
      ))}
    </>
  );
}

function FeatureSplitView({
  featureSplit,
  featureIdx,
  criticalSet,
  onUpdateSubfeature,
  onRemoveSubfeature,
  onAddSubfeature,
}: {
  featureSplit: FeatureSplit;
  featureIdx: number;
  criticalSet: Set<string>;
  onUpdateSubfeature: (featureIdx: number, subIdx: number, patch: Partial<SubFeature>) => void;
  onRemoveSubfeature: (featureIdx: number, subIdx: number) => void;
  onAddSubfeature: (featureIdx: number) => void;
}) {
  return (
    <div className="para-section">
      <div className="para-h">
        <span className="para-h-num">{featureSplit.feature_id}</span>
        <span className="para-h-title">{featureSplit.feature_name}</span>
        <span className="para-h-hint">{featureSplit.subfeatures.length} 条子任务{featureSplit.module_id ? ` · 模块 ${featureSplit.module_id}` : ''}</span>
      </div>
      <div className="subfeature-list">
        {featureSplit.subfeatures.map((sf, si) => {
          const meta = LAYER_META[sf.layer];
          const isCritical = criticalSet.has(sf.id);
          return (
            <div key={sf.id} className={`subfeature-card layer-${meta.cls} ${isCritical ? 'critical' : ''}`}>
              <div className="subfeature-head">
                <select
                  className={`subfeature-layer subfeature-layer-select layer-${meta.cls}`}
                  value={sf.layer}
                  aria-label="子任务层"
                  onChange={(e) => onUpdateSubfeature(featureIdx, si, { layer: e.target.value as SubFeature['layer'] })}
                >
                  {LAYER_OPTIONS.map((l) => (
                    <option key={l} value={l}>{LAYER_META[l].label}</option>
                  ))}
                </select>
                <span className="subfeature-title">
                  <b>
                    <EditableText
                      value={sf.title}
                      placeholder="子任务标题"
                      onChange={(v) => onUpdateSubfeature(featureIdx, si, { title: v })}
                    />
                  </b>
                </span>
                <span className="subfeature-est mono">
                  ⏱{' '}
                  <EditableText
                    value={sf.estimate}
                    placeholder="工作量"
                    onChange={(v) => onUpdateSubfeature(featureIdx, si, { estimate: v })}
                  />
                </span>
                {isCritical ? <span className="subfeature-critical">关键路径</span> : null}
                <span className="subfeature-id mono dim">{sf.id}</span>
                <button
                  type="button"
                  className="subfeature-remove"
                  aria-label="删除这条子任务"
                  title="删除"
                  onClick={() => onRemoveSubfeature(featureIdx, si)}
                >
                  ×
                </button>
              </div>
              <div className="subfeature-desc">
                <EditableTextarea
                  value={sf.description}
                  placeholder="子任务描述…"
                  onChange={(v) => onUpdateSubfeature(featureIdx, si, { description: v })}
                />
              </div>
              <div className="subfeature-meta">
                <div>
                  <b>验收：</b>
                  <EditableList
                    items={sf.acceptance_criteria}
                    placeholder="验收标准…"
                    addLabel="+ 添加验收标准"
                    onChange={(next) => onUpdateSubfeature(featureIdx, si, { acceptance_criteria: next })}
                  />
                </div>
                <div className="dim" style={{ fontSize: 12 }}>
                  <b>依赖：</b>
                  <EditableList
                    items={sf.dependencies}
                    placeholder="依赖的其它子任务 id…"
                    addLabel="+ 添加依赖"
                    onChange={(next) => onUpdateSubfeature(featureIdx, si, { dependencies: next })}
                  />
                </div>
              </div>
            </div>
          );
        })}
        <button type="button" className="btn btn-ghost subfeature-add" onClick={() => onAddSubfeature(featureIdx)}>
          + 添加我的子任务
        </button>
      </div>
    </div>
  );
}
