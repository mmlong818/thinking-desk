'use client';

import { useMemo } from 'react';
import { Copilot } from '@/components/shell/Copilot';
import { useProject } from '@/components/project/ProjectStore';
import { useNodeData, type NodeData } from '@/components/project/useNodeData';
import { useNodeStage } from '@/components/project/useNodeStage';
import { FollowUpsPanel } from '@/components/shared/FollowUpsPanel';
import { JudgeBar } from '@/components/shared/JudgeBar';
import { ContinueButton, MissingUpstream, NodeLink } from '@/components/shared/Navigation';
import { CenteredAction, ErrorCard, LoadingCard, NodeFrame, NodeHat, ParaHead } from '@/components/shared/NodeKit';
import { briefRequestContext } from '@/lib/model/context';
import { DeepResults } from './scen/DeepResults';
import { scenCopilotCards } from './scen/scen-copilot';
import { accepted, deriveScenStage, MAX_DEEP, RUNNING_STAGE, stageChip, type ScenStage } from './scen/scen-meta';
import { DimensionsGrid, ScenariosGrid } from './scen/ScenPickers';
import { useScenActions } from './scen/useScenActions';

type Actions = ReturnType<typeof useScenActions>;

export function ScenariosNode() {
  const { slug } = useProject();
  const data = useNodeData('scen');
  const brief = useMemo(() => briefRequestContext(data.all), [data.all]);
  const derived = deriveScenStage(data);
  const { stage: viewStage, setView } = useNodeStage<ScenStage>(derived);
  const actions = useScenActions(data, brief, () => setView(null));
  const stage = actions.running ? RUNNING_STAGE[actions.running] ?? viewStage : viewStage;
  const copilot = (
    <Copilot
      projectSlug={slug} nodeKind="scen" cards={scenCopilotCards(data, stage, !!brief)}
      pending={['exhausting', 'combining', 'deepening'].includes(stage)}
      extraSlot={stage === 'done' ? <FollowUpsPanel node="scen" items={data.items} /> : null}
    />
  );
  if (!data.loading && !brief) return <NodeFrame copilot={copilot}><MissingScenUpstream /></NodeFrame>;
  return (
    <NodeFrame wide copilot={copilot}>
      <NodeHat kind="scen" chip={stageChip(stage)} />
      <h1 className="node-title">情景分析：挖真需求最锋利的工具</h1>
      <p className="node-intro">
        按 §八 方法论：<em>7 维穷举要素 → 组合具体情景 → 3 个深入</em>。
        产出包括情景×Job 矩阵、极值情景、敌意情景、痛点连续追问到根因、
        以及固定格式的设计启发（"在 X 下，Y 想完成 Z，因此我们可以 D"）。
      </p>
      <Progress stage={stage} />
      {data.loading ? <LoadingCard>正在读取项目数据…</LoadingCard> : null}
      {stage === 'idle' && brief ? <CenteredAction label="第一步：穷举 7 维要素 →" onClick={actions.exhaust} /> : null}
      {stage === 'exhausting' ? <LoadingCard>穷举中 · 每维 8-12 个候选</LoadingCard> : null}
      <StageSections stage={stage} data={data} actions={actions} onBack={() => setView('dimensions')} />
      <ErrorCard title="提示" message={actions.error} mono={false} />
      {stage === 'done' ? (
        <div className="para-section" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <ContinueButton node="scen" label="继续 · 06 功能列表 →" />
          <button type="button" className="btn btn-ghost" onClick={() => setView('idle')}>全部重新来</button>
        </div>
      ) : null}
    </NodeFrame>
  );
}

function MissingScenUpstream() {
  return (
    <MissingUpstream kind="scen" chip={stageChip('idle')} title="情景分析：把用户的世界拆开看" heading="缺少 Brief 上下文">
      <p>
        请先完成 <NodeLink kind="brief">Brief</NodeLink> 和 <NodeLink kind="users">用户与任务</NodeLink>。
      </p>
    </MissingUpstream>
  );
}

function StageSections({ stage, data, actions, onBack }: { stage: ScenStage; data: NodeData; actions: Actions; onBack: () => void }) {
  if (stage === 'dimensions' || stage === 'combining') return <DimensionsStep data={data} actions={actions} busy={stage === 'combining'} />;
  if (stage === 'scenarios' || stage === 'deepening') {
    return <ScenariosStep data={data} actions={actions} busy={stage === 'deepening'} onBack={onBack} />;
  }
  if (stage !== 'done') return null;
  return (
    <>
      <JudgeBar node="scen" judged={['scenario', 'insight', 'pain_point', 'delight_point', 'extreme', 'hostile']} />
      <DeepResults data={data} />
    </>
  );
}

function DimensionsStep({ data, actions, busy }: { data: NodeData; actions: Actions; busy: boolean }) {
  const elements = data.of('scenario_element');
  return (
    <div className="para-section">
      <ParaHead title="7 维要素穷举" hint={`已选 ${accepted(elements).length} · 方法论要求"先发散再收敛"`} />
      <JudgeBar node="scen" judged={['scenario_element']} />
      <DimensionsGrid elements={elements} readOnly={busy} />
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button type="button" className="btn btn-ghost" onClick={actions.exhaust} disabled={busy}>重新穷举</button>
        <button type="button" className="btn btn-accent" onClick={actions.combine} disabled={busy}>
          {busy ? <><span className="ai-spinner" />&nbsp; 组合情景中</> : '第二步：AI 组合情景 →'}
        </button>
      </div>
    </div>
  );
}

function ScenariosStep({ data, actions, busy, onBack }: { data: NodeData; actions: Actions; busy: boolean; onBack: () => void }) {
  const scenarios = data.of('scenario');
  return (
    <div className="para-section">
      <ParaHead title="具体情景（选 3 个深入）" hint={`${scenarios.length} 个候选 · 已选 ${accepted(scenarios).length} / ${MAX_DEEP}`} />
      <ScenariosGrid scenarios={scenarios} readOnly={busy} />
      <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={onBack}>← 回上一步</button>
        <button type="button" className="btn btn-accent" onClick={actions.deep} disabled={busy}>
          {busy ? <><span className="ai-spinner" />&nbsp; 深度分析中</> : '第三步：深度分析 →'}
        </button>
      </div>
    </div>
  );
}

const STEPS: { key: ScenStage[]; label: string }[] = [
  { key: ['exhausting', 'dimensions', 'combining'], label: '1 · 穷举' },
  { key: ['combining', 'scenarios', 'deepening'], label: '2 · 组合' },
  { key: ['scenarios', 'deepening'], label: '3 · 选 3 个' },
  { key: ['deepening', 'done'], label: '4 · 深度分析' },
  { key: ['done'], label: '完成' },
];

function Progress({ stage }: { stage: ScenStage }) {
  const activeIdx = STEPS.findIndex((s) => s.key.includes(stage));
  return (
    <div className="scen-progress">
      {STEPS.map((s, i) => (
        <div key={i} className={`scen-step ${i < activeIdx ? 'past' : ''} ${i === activeIdx ? 'active' : ''}`}>
          <span className="scen-step-dot">{i < activeIdx ? '✓' : i + 1}</span>
          <span className="scen-step-label">{s.label}</span>
        </div>
      ))}
    </div>
  );
}
