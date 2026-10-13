'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { useProject } from '@/components/project/ProjectStore';
import { useAiAction } from '@/components/project/useAiAction';
import { useNodeData, type NodeData } from '@/components/project/useNodeData';
import { FollowUpsPanel } from '@/components/shared/FollowUpsPanel';
import { JudgeBar } from '@/components/shared/JudgeBar';
import { ContinueButton, MissingUpstream, NodeLink } from '@/components/shared/Navigation';
import { ErrorCard, NodeFrame, NodeHat, ParaHead, StoreStatus } from '@/components/shared/NodeKit';
import type { DesignProposal } from '@/lib/ai/schemas/generate-design';
import { adaptDesignProposal } from '@/lib/model/adapters';
import { briefRequestContext, inputsOf, type BriefRequestContext } from '@/lib/model/context';
import { buildFeedback } from '@/lib/model/feedback';
import { FeaturePyramid } from './feat/FeatureLists';
import { sectionsOf } from './final/design-meta';
import { DataModel, UserFlows } from './final/DesignFlows';
import { Modules } from './final/DesignModules';
import { DesignHeader, DesignSection, OpenQuestions, Principles, SectionCards } from './final/DesignParts';
import { Metrics, Milestones, Risks } from './final/DesignTables';
import { useDesignEdit } from './final/useDesignEdit';

const TITLE = '设计案：完整设计输出';
const CHIP = '设计案 · 完整设计输出';

function useGenerate(data: NodeData, brief: BriefRequestContext | null) {
  const { slug } = useProject();
  const ai = useAiAction();
  const generate = () => {
    const features = data.context('final', 'feature');
    const pillars = data.of('pillar').filter((p) => p.decision !== 'rejected');
    const scope = [{ node: 'final' as const, type: 'design_section' as const }, { node: 'final' as const, type: 'module' as const }];
    void ai.run<DesignProposal>('design', {
      route: '/api/ai/generate-design',
      body: {
        projectSlug: slug,
        ...(brief ? { brief: brief.brief } : {}),
        features: features.map((f) => ({
          id: f.id, name: f.body.name, description: f.body.description, pillar: f.body.pillar, kano: f.body.kano,
          rice_score: f.body.rice_score, core_hypothesis: f.body.core_hypothesis, validation_metric: f.body.validation_metric,
        })),
        pillars: pillars.map((p) => ({ id: p.id, ...p.body })),
        feedback: buildFeedback(data.all, scope, data.links),
      },
      node: 'final',
      inputs: inputsOf(brief?.items ?? [], features, pillars),
      adapt: adaptDesignProposal,
    });
  };
  return { generate, generating: ai.running !== null, error: ai.error };
}

function copilotCards(data: NodeData, slug: string): CopilotCard[] {
  if (data.of('feature').length === 0) {
    return [{ tag: 'check', title: '需要先完成 07 跃迁', body: <>请回到 <Link href={`/project/${slug}/leap`} style={{ color: 'var(--accent)' }}>07 创造性跃迁</Link> 应用跃迁后再来。</> }];
  }
  const sections = data.of('design_section');
  const [overview] = sectionsOf(sections, 'overview');
  if (!overview) {
    return [{ tag: 'feed', title: '点"生成设计案"', body: '我会基于跃迁后的功能列表 + Brief + 场景，输出一份完整设计文档：信息架构 / 模块 / 用户流 / 数据模型 / 技术骨架 / 里程碑。' }];
  }
  const [principles] = sectionsOf(sections, 'principles');
  return [
    { tag: 'feed', title: overview.body.title, body: overview.body.one_liner },
    { tag: 'feed', title: '设计原则', body: principles?.body.items.join(' · ') ?? '' },
    ...sectionsOf(sections, 'risk').slice(0, 3).map((r): CopilotCard => ({ tag: 'critique', title: '风险', body: `${r.body.risk} → ${r.body.mitigation}` })),
    ...sectionsOf(sections, 'open_question').slice(0, 2).map((q): CopilotCard => ({ tag: 'ask', title: '待决策', body: q.body.text })),
  ];
}

export function FinalFeaturesNode() {
  const { slug } = useProject();
  const data = useNodeData('final');
  const brief = useMemo(() => briefRequestContext(data.all), [data.all]);
  const { generate, generating, error } = useGenerate(data, brief);
  const features = data.of('feature');
  const hasDesign = data.of('design_section').length > 0 || data.of('module').length > 0;
  const copilot = (
    <Copilot projectSlug={slug} nodeKind="final" cards={copilotCards(data, slug)} pending={generating}
      extraSlot={features.length > 0 ? <FollowUpsPanel node="final" items={data.items} /> : null} />
  );
  if (!data.loading && features.length === 0) return <NodeFrame copilot={copilot}><NotYetLeapt data={data} /></NodeFrame>;
  return (
    <NodeFrame wide copilot={copilot} redo={[{
      label: '重新生成设计案', node: 'final', types: ['design_section', 'module'], run: generate, busy: generating,
    }]}>
      <NodeHat kind="final" chip={CHIP} />
      <h1 className="node-title">{TITLE}</h1>
      <p className="node-intro">
        从 07 跃迁后的功能列表 → 一份<em>真正可执行的设计文档</em>。
        产出包含：信息架构、模块拆分、关键用户流、核心交互、数据模型、技术骨架、指标、风险、里程碑。
      </p>
      <StoreStatus data={data} />
      {data.loading ? null : <FinalFeatureList data={data} />}
      {data.loading ? null : hasDesign ? (
        <DesignView data={data} onRegenerate={generate} regenerating={generating} />
      ) : (
        <GenerateCta data={data} onGenerate={generate} generating={generating} />
      )}
      <ErrorCard message={error} />
      {hasDesign ? (
        <div className="para-section" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ContinueButton node="final" />
          <Link href={`/project/${slug}/leap`} className="btn btn-ghost">← 回到 07 跃迁</Link>
        </div>
      ) : null}
    </NodeFrame>
  );
}

function NotYetLeapt({ data }: { data: NodeData }) {
  const conventional = data.of('feature', 'feat').length;
  return (
    <MissingUpstream kind="final" chip={CHIP} title={TITLE} heading="尚未跃迁">
      <p>请回到 <NodeLink kind="leap">07 创造性跃迁</NodeLink>，选好跃迁并点"应用跃迁"按钮。</p>
      {conventional > 0 ? (
        <p style={{ marginTop: 8, color: 'var(--ink-4)', fontSize: 12 }}>原常规功能列表已就绪（{conventional} 个）· 等待跃迁应用。</p>
      ) : null}
    </MissingUpstream>
  );
}

function FinalFeatureList({ data }: { data: NodeData }) {
  return (
    <div className="para-section">
      <ParaHead title="跃迁后的功能列表" hint="设计案的输入 · 已采纳的优先，未裁决的也会带入，否决的不带入" />
      <details className="ctx-card">
        <summary>{data.of('feature').length} 个功能 · {data.of('pillar').length} 个支柱 · 点开逐条裁决</summary>
        <div className="ctx-body">
          <FeaturePyramid pillars={data.of('pillar')} features={data.of('feature')} links={data.links} all={data.all} plain />
        </div>
      </details>
    </div>
  );
}

function GenerateCta({ data, onGenerate, generating }: { data: NodeData; onGenerate: () => void; generating: boolean }) {
  return (
    <div className="para-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <div className="dim" style={{ fontSize: 13 }}>
        输入：{data.context('final', 'feature').length} 个功能 · {data.of('pillar').filter((p) => p.decision !== 'rejected').length} 个支柱
      </div>
      <button type="button" className="btn btn-accent" onClick={onGenerate} disabled={generating}>
        {generating ? <><span className="ai-spinner" /> &nbsp;生成中… 通常 60-120 秒</> : '生成完整设计案 →'}
      </button>
    </div>
  );
}

function DesignView({ data, onRegenerate, regenerating }: { data: NodeData; onRegenerate: () => void; regenerating: boolean }) {
  const edit = useDesignEdit();
  const sections = data.of('design_section');
  const of = <K extends Parameters<typeof sectionsOf>[1]>(k: K) => sectionsOf(sections, k);
  const byId = useMemo(() => new Map(data.all.map((i) => [i.id, i])), [data.all]);
  const [overview] = of('overview');
  const [principles] = of('principles');
  const modules = data.of('module');
  return (
    <div className="design-view">
      <JudgeBar node="final" judged={['design_section', 'module']} />
      {overview ? <DesignHeader overview={overview} edit={edit} onRegenerate={onRegenerate} regenerating={regenerating} /> : null}
      {principles ? <DesignSection num="§ 1" title="设计原则"><Principles item={principles} edit={edit} /></DesignSection> : null}
      <DesignSection num="§ 2" title="信息架构"><SectionCards items={of('ia')} edit={edit} /></DesignSection>
      <DesignSection num="§ 3" title={`模块拆分（${modules.length}）`}><Modules modules={modules} links={data.links} byId={byId} features={data.of('feature')} /></DesignSection>
      <DesignSection num="§ 4" title={`关键用户流（${of('flow').length}）`}><UserFlows items={of('flow')} edit={edit} /></DesignSection>
      <DesignSection num="§ 5" title="核心交互"><SectionCards items={of('interaction')} edit={edit} /></DesignSection>
      <DesignSection num="§ 6" title={`数据模型（${of('data_entity').length}）`}><DataModel items={of('data_entity')} edit={edit} /></DesignSection>
      <DesignSection num="§ 7" title="技术骨架"><SectionCards items={of('tech')} edit={edit} /></DesignSection>
      <DesignSection num="§ 8" title={`指标（${of('metric').length}）`}><Metrics items={of('metric')} edit={edit} /></DesignSection>
      <DesignSection num="§ 9" title={`里程碑（${of('milestone').length}）`}><Milestones items={of('milestone')} edit={edit} /></DesignSection>
      <DesignSection num="§ 10" title="风险与缓解"><Risks items={of('risk')} edit={edit} /></DesignSection>
      <DesignSection num="§ 11" title="待决策问题"><OpenQuestions items={of('open_question')} edit={edit} /></DesignSection>
      {edit.error ? <div className="idc-error">{edit.error}</div> : null}
    </div>
  );
}
