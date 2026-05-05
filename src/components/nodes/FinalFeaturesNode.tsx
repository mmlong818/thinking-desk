'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { NodeFollowUpsSection } from '@/components/shared/NodeFollowUpsSection';
import { EditableText, EditableTextarea, EditableList } from '@/components/shared/Editable';
import type { Feature, FeatureList, Pillar } from '@/lib/ai/tasks/draft-features';
import type { CreativeLeapAnalysis } from '@/lib/ai/tasks/creative-leap';
import type { DesignProposal, Milestone, UserFlow, DataEntity } from '@/lib/ai/tasks/generate-design';
import type { BriefExtraction } from '@/lib/ai/tasks/extract-brief';
import { readCache, writeCache } from '@/lib/client-cache';
import { readPreferredModel } from '@/lib/client-model';
import { nextNodeKind, getNode, formatNodeNum } from '@/data/nodes';

export interface FinalContent {
  features: Feature[];
  pillars: Pillar[];
  not_doing: { name: string; reason: string; why: string }[];
  differentiation_echo: string;
  revision: {
    revisions: unknown[];
    summary: string;
    selected_leap_ids: string[];
    revised_at: string;
  };
  source_features?: Feature[];
  source_pillars?: Pillar[];
  // 新增：生成的设计案
  design?: DesignProposal;
  designed_at?: string;
}

interface Props {
  projectSlug: string;
  initial?: FinalContent;
  featContent?: FeatureList | null;
  leapContent?: CreativeLeapAnalysis | null;
  brief?: BriefExtraction | null;
}

interface CachedBrief extends BriefExtraction {
  raw_text?: string;
}

export function FinalFeaturesNode({ projectSlug, initial, featContent, brief }: Props) {
  const router = useRouter();
  const [data, setData] = useState<FinalContent | null>(initial ?? null);
  const [cachedFeat, setCachedFeat] = useState<FeatureList | null>(featContent ?? null);
  const [cachedBrief, setCachedBrief] = useState<BriefExtraction | null>(brief ?? null);
  const [design, setDesign] = useState<DesignProposal | null>(initial?.design ?? null);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();

  useEffect(() => {
    if (!data) {
      const c = readCache<FinalContent>(projectSlug, 'final');
      if (c) {
        setData(c);
        if (c.design) setDesign(c.design);
      }
    }
    if (!cachedFeat) {
      const c = readCache<FeatureList>(projectSlug, 'feat');
      if (c) setCachedFeat(c);
    }
    if (!cachedBrief) {
      const c = readCache<CachedBrief>(projectSlug, 'brief');
      if (c) {
        setCachedBrief({
          highlights: c.highlights,
          fields: c.fields,
          follow_ups: c.follow_ups,
          completeness: c.completeness,
        });
      }
    }
    const cachedDesign = readCache<DesignProposal>(projectSlug, 'design');
    if (cachedDesign && !design) setDesign(cachedDesign);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  const features = data?.features ?? cachedFeat?.features ?? [];
  const pillars = data?.pillars ?? cachedFeat?.pillars ?? [];

  const patchDesign = (next: DesignProposal) => {
    setDesign(next);
    writeCache(projectSlug, 'design', next);
    if (data) {
      const merged: FinalContent = { ...data, design: next };
      writeCache(projectSlug, 'final', merged);
      setData(merged);
    }
  };

  const generate = () => {
    setError(null);
    setGenerating(true);
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = { projectSlug };
        const preferred = readPreferredModel();
        if (preferred) payload.model = preferred;
        const briefToSend = brief ?? cachedBrief;
        if (briefToSend) payload.brief = briefToSend;
        if (features.length > 0) payload.features = features;
        if (pillars.length > 0) payload.pillars = pillars;

        const res = await fetch('/api/ai/generate-design', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as { ok?: boolean; data?: DesignProposal; error?: string; detail?: string };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '生成失败');
        }
        setDesign(json.data);
        writeCache(projectSlug, 'design', json.data);
        if (data) {
          const next: FinalContent = { ...data, design: json.data, designed_at: new Date().toISOString() };
          writeCache(projectSlug, 'final', next);
          setData(next);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setGenerating(false);
      }
    });
  };

  const copilotCards = useMemo<CopilotCard[]>(() => {
    if (!data) {
      return [{
        tag: 'check',
        title: '需要先完成 07 跃迁',
        body: <>请回到 <Link href={`/project/${projectSlug}/leap`} style={{ color: 'var(--accent)' }}>07 创造性跃迁</Link> 应用跃迁后再来。</>,
      }];
    }
    if (!design) {
      return [{
        tag: 'feed',
        title: '点"生成设计案"',
        body: '我会基于跃迁后的功能列表 + Brief + 场景，输出一份完整设计文档：信息架构 / 模块 / 用户流 / 数据模型 / 技术骨架 / 里程碑。',
      }];
    }
    const cards: CopilotCard[] = [
      { tag: 'feed', title: design.title, body: design.one_liner },
      { tag: 'feed', title: '设计原则', body: design.design_principles.join(' · ') },
    ];
    for (const r of design.risks.slice(0, 3)) {
      cards.push({ tag: 'critique', title: '风险', body: `${r.risk} → ${r.mitigation}` });
    }
    for (const q of design.open_questions.slice(0, 2)) {
      cards.push({ tag: 'ask', title: '待决策', body: q });
    }
    return cards;
  }, [data, design, projectSlug]);

  if (!data) {
    return (
      <div className="main">
        <main className="work">
          <div className="work-inner">
            <NodeHat />
            <h1 className="node-title">设计案：完整设计输出</h1>
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-state-title">尚未跃迁</div>
              <p>请回到 <Link href={`/project/${projectSlug}/leap`} style={{ color: 'var(--accent)' }}>07 创造性跃迁</Link>，选好跃迁并点"应用跃迁"按钮。</p>
              {cachedFeat?.features?.length ? (
                <p style={{ marginTop: 8, color: 'var(--ink-4)', fontSize: 12 }}>
                  原常规功能列表已就绪（{cachedFeat.features.length} 个）· 等待跃迁应用。
                </p>
              ) : null}
            </div>
          </div>
        </main>
        <Copilot projectSlug={projectSlug} nodeKind="final" cards={copilotCards} />
      </div>
    );
  }

  return (
    <div className="main">
      <main className="work wide">
        <div className="work-inner">
          <NodeHat />
          <h1 className="node-title">设计案：完整设计输出</h1>
          <p className="node-intro">
            从 07 跃迁后的功能列表 → 一份<em>真正可执行的设计文档</em>。
            产出包含：信息架构、模块拆分、关键用户流、核心交互、数据模型、技术骨架、指标、风险、里程碑。
          </p>

          {!design ? (
            <div className="para-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
              <div className="dim" style={{ fontSize: 13 }}>
                输入：{features.length} 个功能 · {pillars.length} 个支柱
              </div>
              <button
                type="button"
                className="btn btn-accent"
                onClick={generate}
                disabled={generating}
              >
                {generating ? <><span className="ai-spinner" /> &nbsp;生成中… 通常 60-120 秒</> : '生成完整设计案 →'}
              </button>
            </div>
          ) : (
            <DesignView design={design} onRegenerate={generate} regenerating={generating} onPatch={patchDesign} />
          )}

          {error ? (
            <div className="cop-card" style={{ marginTop: 14, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
              <div className="cop-card-title">调用失败</div>
              <div className="cop-card-body" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{error}</div>
            </div>
          ) : null}

          {design ? (
            <div className="para-section" style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => {
                  const n = nextNodeKind('final');
                  if (n) router.push(`/project/${projectSlug}/${n}`);
                }}
              >
                {(() => {
                  const n = nextNodeKind('final');
                  const node = n ? getNode(n) : null;
                  return node ? `继续 · ${node.num} ${node.label} →` : '继续 →';
                })()}
              </button>
              <Link href={`/project/${projectSlug}/leap`} className="btn btn-ghost">← 回到 07 跃迁</Link>
            </div>
          ) : null}
        </div>
      </main>
      <Copilot projectSlug={projectSlug} nodeKind="final" cards={copilotCards} pending={generating}
        extraSlot={data ? <NodeFollowUpsSection projectSlug={projectSlug} nodeKind="final" content={data as unknown as Record<string, unknown>} /> : null}
      />
    </div>
  );
}

function NodeHat() {
  return (
    <div className="node-hat">
      <span className="node-hat-num">{formatNodeNum('final')}</span>
      <span className="node-hat-rule" />
      <span className="node-hat-chip">设计案 · 完整设计输出</span>
    </div>
  );
}

function DesignView({
  design,
  onRegenerate,
  regenerating,
  onPatch,
}: {
  design: DesignProposal;
  onRegenerate: () => void;
  regenerating: boolean;
  onPatch: (next: DesignProposal) => void;
}) {
  const patch = (mut: Partial<DesignProposal>) => onPatch({ ...design, ...mut });
  return (
    <div className="design-view">
      <DesignHeader design={design} onRegenerate={onRegenerate} regenerating={regenerating} onPatch={patch} />
      <DesignSection num="§ 1" title="设计原则">
        <EditableList
          items={design.design_principles}
          placeholder="一条设计原则…"
          addLabel="+ 添加我的设计原则"
          onChange={(next) => patch({ design_principles: next })}
        />
      </DesignSection>
      <DesignSection num="§ 2" title="信息架构">
        <SectionList
          items={design.information_architecture}
          onChange={(next) => patch({ information_architecture: next })}
        />
      </DesignSection>
      <DesignSection num="§ 3" title={`模块拆分（${design.modules.length}）`}>
        <div className="design-modules">
          {design.modules.map((m, mi) => (
            <div key={m.id} className="design-module-card">
              <div className="design-module-head">
                <span className="design-module-name">
                  <EditableText
                    value={m.name}
                    placeholder="模块名"
                    onChange={(v) => {
                      const modules = design.modules.map((mm, i) => (i === mi ? { ...mm, name: v } : mm));
                      patch({ modules });
                    }}
                  />
                </span>
                <span className="design-module-id mono dim">{m.id}</span>
              </div>
              <div className="design-module-body">
                <EditableTextarea
                  value={m.responsibility}
                  placeholder="模块职责…"
                  onChange={(v) => {
                    const modules = design.modules.map((mm, i) => (i === mi ? { ...mm, responsibility: v } : mm));
                    patch({ modules });
                  }}
                />
              </div>
              <div className="design-module-meta">
                <div><b>关联功能：</b>{m.feature_ids.join(', ') || '—'}</div>
                <div><b>主要屏幕：</b>{m.key_screens.join(' · ') || '—'}</div>
                {m.depends_on.length > 0 ? <div><b>依赖：</b>{m.depends_on.join(' · ')}</div> : null}
              </div>
            </div>
          ))}
        </div>
      </DesignSection>
      <DesignSection num="§ 4" title={`关键用户流（${design.user_flows.length}）`}>
        <EditableUserFlows
          items={design.user_flows}
          onChange={(next) => patch({ user_flows: next })}
        />
      </DesignSection>
      <DesignSection num="§ 5" title="核心交互">
        <SectionList
          items={design.key_interactions}
          onChange={(next) => patch({ key_interactions: next })}
        />
      </DesignSection>
      <DesignSection num="§ 6" title={`数据模型（${design.data_model.length}）`}>
        <EditableDataModel
          items={design.data_model}
          onChange={(next) => patch({ data_model: next })}
        />
      </DesignSection>
      <DesignSection num="§ 7" title="技术骨架">
        <SectionList
          items={design.tech_skeleton}
          onChange={(next) => patch({ tech_skeleton: next })}
        />
      </DesignSection>
      <DesignSection num="§ 8" title={`指标（${design.metrics.length}）`}>
        <EditableMetrics
          items={design.metrics}
          onChange={(next) => patch({ metrics: next })}
        />
      </DesignSection>
      <DesignSection num="§ 9" title={`里程碑（${design.milestones.length}）`}>
        <EditableMilestones
          items={design.milestones}
          onChange={(next) => patch({ milestones: next })}
        />
      </DesignSection>
      <DesignSection num="§ 10" title="风险与缓解">
        <EditableRisks
          items={design.risks}
          onChange={(next) => patch({ risks: next })}
        />
      </DesignSection>
      <DesignSection num="§ 11" title="待决策问题">
        <EditableList
          items={design.open_questions}
          placeholder="一个还没拿定主意的问题…"
          addLabel="+ 添加我的待决策"
          onChange={(next) => patch({ open_questions: next })}
        />
      </DesignSection>
    </div>
  );
}

function DesignHeader({
  design,
  onRegenerate,
  regenerating,
  onPatch,
}: {
  design: DesignProposal;
  onRegenerate: () => void;
  regenerating: boolean;
  onPatch: (mut: Partial<DesignProposal>) => void;
}) {
  return (
    <div className="design-header">
      <div style={{ flex: 1 }}>
        <h2 className="design-title">
          <EditableText
            value={design.title}
            placeholder="设计案标题"
            onChange={(v) => onPatch({ title: v })}
          />
        </h2>
        <div className="design-oneliner">
          <EditableText
            value={design.one_liner}
            placeholder="一句话定义这个设计…"
            onChange={(v) => onPatch({ one_liner: v })}
          />
        </div>
        <div className="design-vision">
          <EditableTextarea
            value={design.vision}
            placeholder="愿景…"
            onChange={(v) => onPatch({ vision: v })}
          />
        </div>
      </div>
      <button type="button" className="btn btn-ghost" onClick={onRegenerate} disabled={regenerating}>
        {regenerating ? '重新生成中…' : '重新生成'}
      </button>
    </div>
  );
}

function DesignSection({ num, title, children }: { num: string; title: string; children: React.ReactNode }) {
  return (
    <div className="para-section">
      <div className="para-h">
        <span className="para-h-num">{num}</span>
        <span className="para-h-title">{title}</span>
      </div>
      {children}
    </div>
  );
}

function SectionList({
  items,
  onChange,
}: {
  items: { id: string; title: string; body: string }[];
  onChange?: (next: { id: string; title: string; body: string }[]) => void;
}) {
  return (
    <div className="design-sections">
      {items.map((s, idx) => (
        <div key={s.id} className="design-section-card">
          <div className="design-section-title">
            <b>
              {onChange ? (
                <EditableText
                  value={s.title}
                  placeholder="标题"
                  onChange={(v) => onChange(items.map((it, i) => (i === idx ? { ...it, title: v } : it)))}
                />
              ) : (
                s.title
              )}
            </b>
          </div>
          <div className="design-section-body">
            {onChange ? (
              <EditableTextarea
                value={s.body}
                placeholder="说明…"
                onChange={(v) => onChange(items.map((it, i) => (i === idx ? { ...it, body: v } : it)))}
              />
            ) : (
              s.body
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function EditableMetrics({
  items,
  onChange,
}: {
  items: { name: string; definition: string; target: string }[];
  onChange: (next: { name: string; definition: string; target: string }[]) => void;
}) {
  const patch = (idx: number, mut: Partial<(typeof items)[number]>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...mut } : it)));
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const add = () => onChange([...items, { name: '', definition: '', target: '' }]);
  return (
    <div className="design-table-edit">
      <table className="design-metrics-table">
        <thead><tr><th>指标</th><th>定义</th><th>目标</th><th aria-label="操作" /></tr></thead>
        <tbody>
          {items.map((m, i) => (
            <tr key={i}>
              <td><b><EditableText value={m.name} placeholder="指标名" onChange={(v) => patch(i, { name: v })} /></b></td>
              <td><EditableText value={m.definition} placeholder="如何定义" onChange={(v) => patch(i, { definition: v })} /></td>
              <td className="mono"><EditableText value={m.target} placeholder="目标值" onChange={(v) => patch(i, { target: v })} /></td>
              <td><button type="button" className="editable-remove" title="删除" onClick={() => remove(i)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="editable-add" onClick={add}>+ 添加我的指标</button>
    </div>
  );
}

function EditableRisks({
  items,
  onChange,
}: {
  items: { risk: string; mitigation: string }[];
  onChange: (next: { risk: string; mitigation: string }[]) => void;
}) {
  const patch = (idx: number, mut: Partial<(typeof items)[number]>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...mut } : it)));
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const add = () => onChange([...items, { risk: '', mitigation: '' }]);
  return (
    <div className="design-table-edit">
      <table className="design-metrics-table">
        <thead><tr><th>风险</th><th>缓解</th><th aria-label="操作" /></tr></thead>
        <tbody>
          {items.map((r, i) => (
            <tr key={i}>
              <td><EditableTextarea value={r.risk} placeholder="一条风险…" onChange={(v) => patch(i, { risk: v })} /></td>
              <td><EditableTextarea value={r.mitigation} placeholder="如何缓解…" onChange={(v) => patch(i, { mitigation: v })} /></td>
              <td><button type="button" className="editable-remove" title="删除" onClick={() => remove(i)}>×</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" className="editable-add" onClick={add}>+ 添加我的风险</button>
    </div>
  );
}

function EditableMilestones({
  items,
  onChange,
}: {
  items: Milestone[];
  onChange: (next: Milestone[]) => void;
}) {
  const patch = (idx: number, mut: Partial<Milestone>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...mut } : it)));
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const add = () =>
    onChange([...items, { phase: '', goal: '', deliverables: [], duration: '' }]);
  return (
    <div className="design-milestones">
      {items.map((m, i) => (
        <div key={i} className="design-milestone">
          <div className="design-milestone-head">
            <b><EditableText value={m.phase} placeholder="阶段名" onChange={(v) => patch(i, { phase: v })} /></b>
            <span className="dim">
              {' · '}
              <EditableText value={m.duration} placeholder="时长" onChange={(v) => patch(i, { duration: v })} />
            </span>
            <button type="button" className="editable-remove" style={{ marginLeft: 'auto' }} title="删除" onClick={() => remove(i)}>×</button>
          </div>
          <div>
            <EditableTextarea
              value={m.goal}
              placeholder="阶段目标…"
              onChange={(v) => patch(i, { goal: v })}
            />
          </div>
          <EditableList
            items={m.deliverables}
            placeholder="一个交付物…"
            addLabel="+ 添加交付物"
            onChange={(next) => patch(i, { deliverables: next })}
          />
        </div>
      ))}
      <button type="button" className="editable-add" onClick={add}>+ 添加我的里程碑</button>
    </div>
  );
}

function EditableUserFlows({
  items,
  onChange,
}: {
  items: UserFlow[];
  onChange: (next: UserFlow[]) => void;
}) {
  const patchFlow = (idx: number, mut: Partial<UserFlow>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...mut } : it)));
  const removeFlow = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const addFlow = () => {
    const id = `flow-${Date.now().toString(36).slice(-4)}`;
    onChange([
      ...items,
      {
        id,
        name: '',
        goal: '',
        precondition: '',
        steps: [
          { step: 1, actor: '', action: '', system_response: '' },
          { step: 2, actor: '', action: '', system_response: '' },
        ],
        success_criteria: '',
        failure_handling: '',
      },
    ]);
  };

  const patchStep = (fi: number, si: number, mut: Partial<UserFlow['steps'][number]>) => {
    const flow = items[fi];
    const steps = flow.steps.map((s, j) => (j === si ? { ...s, ...mut } : s));
    patchFlow(fi, { steps });
  };
  const removeStep = (fi: number, si: number) => {
    const flow = items[fi];
    const steps = flow.steps
      .filter((_, j) => j !== si)
      .map((s, j) => ({ ...s, step: j + 1 }));
    patchFlow(fi, { steps });
  };
  const addStep = (fi: number) => {
    const flow = items[fi];
    patchFlow(fi, {
      steps: [...flow.steps, { step: flow.steps.length + 1, actor: '', action: '', system_response: '' }],
    });
  };

  return (
    <>
      {items.map((f, fi) => (
        <div key={f.id} className="design-flow">
          <div className="design-flow-head">
            <b><EditableText value={f.name} placeholder="用户流名" onChange={(v) => patchFlow(fi, { name: v })} /></b>
            <span className="dim">
              {' · '}
              <EditableText value={f.goal} placeholder="目标" onChange={(v) => patchFlow(fi, { goal: v })} />
            </span>
            <button type="button" className="editable-remove" style={{ marginLeft: 'auto' }} title="删除整个用户流" onClick={() => removeFlow(fi)}>×</button>
          </div>
          <div className="design-flow-pre">
            <b>前置：</b>
            <EditableText value={f.precondition} placeholder="前置条件…" onChange={(v) => patchFlow(fi, { precondition: v })} />
          </div>
          <ol className="design-flow-steps">
            {f.steps.map((s, si) => (
              <li key={si} className="design-flow-step-row">
                <div className="design-flow-step-line">
                  <b><EditableText value={s.actor} placeholder="谁" onChange={(v) => patchStep(fi, si, { actor: v })} /></b>
                  <span>：</span>
                  <EditableText value={s.action} placeholder="做什么" onChange={(v) => patchStep(fi, si, { action: v })} />
                  <button type="button" className="editable-remove" title="删除这一步" onClick={() => removeStep(fi, si)}>×</button>
                </div>
                <div className="design-flow-resp">
                  → <EditableText value={s.system_response} placeholder="系统响应…" onChange={(v) => patchStep(fi, si, { system_response: v })} />
                </div>
              </li>
            ))}
            <li><button type="button" className="editable-add" onClick={() => addStep(fi)}>+ 添加一步</button></li>
          </ol>
          <div className="design-flow-foot">
            <span>
              <b>成功：</b>
              <EditableText value={f.success_criteria} placeholder="怎么算成功…" onChange={(v) => patchFlow(fi, { success_criteria: v })} />
            </span>
            <span>
              <b>失败处理：</b>
              <EditableText value={f.failure_handling} placeholder="失败时…" onChange={(v) => patchFlow(fi, { failure_handling: v })} />
            </span>
          </div>
        </div>
      ))}
      <button type="button" className="editable-add" onClick={addFlow}>+ 添加我的用户流</button>
    </>
  );
}

function EditableDataModel({
  items,
  onChange,
}: {
  items: DataEntity[];
  onChange: (next: DataEntity[]) => void;
}) {
  const patchEntity = (idx: number, mut: Partial<DataEntity>) =>
    onChange(items.map((it, i) => (i === idx ? { ...it, ...mut } : it)));
  const removeEntity = (idx: number) => onChange(items.filter((_, i) => i !== idx));
  const addEntity = () =>
    onChange([...items, { name: '', description: '', fields: [{ name: '', type: '', note: '' }] }]);

  const patchField = (ei: number, fi: number, mut: Partial<DataEntity['fields'][number]>) => {
    const entity = items[ei];
    const fields = entity.fields.map((f, j) => (j === fi ? { ...f, ...mut } : f));
    patchEntity(ei, { fields });
  };
  const removeField = (ei: number, fi: number) => {
    const entity = items[ei];
    patchEntity(ei, { fields: entity.fields.filter((_, j) => j !== fi) });
  };
  const addField = (ei: number) => {
    const entity = items[ei];
    patchEntity(ei, { fields: [...entity.fields, { name: '', type: '', note: '' }] });
  };

  return (
    <div className="design-entities">
      {items.map((e, ei) => (
        <div key={ei} className="design-entity">
          <div className="design-entity-head">
            <b><EditableText value={e.name} placeholder="实体名" onChange={(v) => patchEntity(ei, { name: v })} /></b>
            <span className="dim">
              {' · '}
              <EditableText value={e.description} placeholder="实体说明…" onChange={(v) => patchEntity(ei, { description: v })} />
            </span>
            <button type="button" className="editable-remove" style={{ marginLeft: 'auto' }} title="删除整个实体" onClick={() => removeEntity(ei)}>×</button>
          </div>
          <table className="design-entity-table">
            <thead><tr><th>字段</th><th>类型</th><th>说明</th><th aria-label="操作" /></tr></thead>
            <tbody>
              {e.fields.map((f, fi) => (
                <tr key={fi}>
                  <td className="mono"><EditableText value={f.name} placeholder="field_name" onChange={(v) => patchField(ei, fi, { name: v })} /></td>
                  <td className="mono dim"><EditableText value={f.type} placeholder="string / int…" onChange={(v) => patchField(ei, fi, { type: v })} /></td>
                  <td><EditableText value={f.note} placeholder="说明" onChange={(v) => patchField(ei, fi, { note: v })} /></td>
                  <td><button type="button" className="editable-remove" title="删除字段" onClick={() => removeField(ei, fi)}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className="editable-add" onClick={() => addField(ei)}>+ 添加字段</button>
        </div>
      ))}
      <button type="button" className="editable-add" onClick={addEntity}>+ 添加我的实体</button>
    </div>
  );
}
