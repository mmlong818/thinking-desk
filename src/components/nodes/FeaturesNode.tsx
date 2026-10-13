'use client';

import { useMemo } from 'react';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { useProject } from '@/components/project/ProjectStore';
import { useAiAction } from '@/components/project/useAiAction';
import { useNodeData, type NodeData } from '@/components/project/useNodeData';
import { critiqueCards, summaryText } from '@/components/shared/copilot-cards';
import { FollowUpsPanel } from '@/components/shared/FollowUpsPanel';
import { JudgeBar } from '@/components/shared/JudgeBar';
import { ContinueButton, MissingUpstream, NodeLink } from '@/components/shared/Navigation';
import {
  CenteredAction, ErrorCard, LoadingCard, NodeFrame, NodeHat, ParaHead, StoreStatus,
} from '@/components/shared/NodeKit';
import { adaptFeatureList } from '@/lib/model/adapters';
import { briefRequestContext, inputsOf, type BriefRequestContext } from '@/lib/model/context';
import { buildFeedback } from '@/lib/model/feedback';
import {
  briefPayload, insightPayload, jobPayload, personaPayload, scenarioPayload,
} from '@/lib/store/request-context';
import { FeaturePyramid, NotDoingList, PillarsStrip } from './feat/FeatureLists';
import { isRecommended } from './feat/feat-meta';

type Stage = 'idle' | 'drafting' | 'done';
const TITLE = '功能列表：让每一个功能都有出处';
const STAGE_CHIP: Record<Stage, string> = { idle: '功能列表 · 预计 45 分钟', drafting: '收口中…', done: '已起草 · 可调整' };

/** Everything the features prompt reads from upstream (accepted items, else the unjudged ones). */
function upstreamOf(data: NodeData) {
  return {
    personas: data.context('users', 'persona'),
    jobs: data.context('users', 'job'),
    scenarios: data.of('scenario', 'scen').filter((s) => s.decision === 'accepted'),
    insights: data.context('scen', 'insight'),
    pains: data.context('scen', 'pain_point'),
    diff: data.context('alt', 'diff_hypothesis')[0],
  };
}

function useDraft(data: NodeData, brief: BriefRequestContext | null) {
  const { slug } = useProject();
  const ai = useAiAction();
  const draft = () => {
    if (!brief) return;
    const u = upstreamOf(data);
    const jobIds = new Set(u.jobs.map((j) => j.id));
    void ai.run('draft', {
      route: '/api/ai/features',
      body: {
        projectSlug: slug, ...briefPayload(brief),
        personas: u.personas.map(personaPayload),
        lockedJobs: u.jobs.map((j) => jobPayload(j, data.links)),
        scenarios: u.scenarios.map((s) => scenarioPayload(s, data.links, jobIds)),
        design_insights: u.insights.map((i) => insightPayload(i, data.links)),
        pain_points: u.pains.map((p) => ({ id: p.id, moment: p.body.moment, root_cause: p.body.root_cause })),
        ...(u.diff ? { differentiation_hypothesis: u.diff.body.statement } : {}),
        feedback: buildFeedback(data.all, [{ node: 'feat', type: 'feature' }, { node: 'feat', type: 'not_doing' }], data.links),
      },
      node: 'feat',
      inputs: inputsOf(brief.items, u.personas, u.jobs, u.scenarios, u.insights, u.pains, u.diff ? [u.diff] : []),
      adapt: adaptFeatureList,
    });
  };
  return { draft, running: ai.running !== null, error: ai.error };
}

function idleCard(data: NodeData): CopilotCard {
  const u = upstreamOf(data);
  return {
    tag: 'feed',
    title: '准备收口为功能列表',
    body: (
      <>
        §九 要求我把上游所有分析<em>收口成"可执行的假设清单"</em>：每个功能必须追溯到<em>设计启发 / Job / 痛点</em>。
        <div style={{ marginTop: 8 }}>
          我会产出 <b>金字塔结构</b> · <b>Kano 五分类</b> · <b>RICE 评分</b> · <b>五问法</b> · <b>功能卡片（即假设）</b> · <b>不做什么清单</b>。
        </div>
        {u.insights.length === 0 ? (
          <div className="dim" style={{ marginTop: 8, fontSize: 12, color: 'var(--warn)' }}>⚠ 尚未完成情景节点的设计启发。功能会偏抽象。建议先走完 05 情景。</div>
        ) : (
          <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
            上游已就绪：{u.insights.length} 条设计启发 · {u.jobs.length} 条锁 Job · {u.personas.length} 个 persona{u.diff ? ' · 差异化假设已获取' : ''}
          </div>
        )}
      </>
    ),
  };
}

function copilotCards(data: NodeData, stage: Stage, hasBrief: boolean): CopilotCard[] {
  if (!hasBrief) return [{ tag: 'check', title: '需要 Brief', body: '请先完成上游节点' }];
  if (stage === 'idle') return [idleCard(data)];
  if (stage === 'drafting') return [{ tag: 'feed', title: '收口中…', body: '把 §5-8 所有产出综合成 pyramids + features + not_doing。通常 90-180 秒。' }];
  const features = data.of('feature');
  const redLines = features.filter((f) => f.body.red_line_risk).length;
  return [
    {
      tag: 'feed',
      title: `${features.length} 个功能 · ${data.of('pillar').length} 支柱 · ${features.filter(isRecommended).length} 个建议优先`,
      body: (
        <>
          {redLines > 0 ? <div style={{ color: 'var(--danger)', fontWeight: 500, marginBottom: 6 }}>⚠ {redLines} 个功能触发了道德红线 —— 必须审查</div> : null}
          差异化假设回响：<em>{summaryText(data.items, 'differentiation_echo')}</em>
        </>
      ),
    },
    ...critiqueCards(data.items),
  ];
}

export function FeaturesNode() {
  const { slug } = useProject();
  const data = useNodeData('feat');
  const brief = useMemo(() => briefRequestContext(data.all), [data.all]);
  const { draft, running, error } = useDraft(data, brief);
  const stage: Stage = running ? 'drafting' : data.of('feature').length > 0 ? 'done' : 'idle';
  const copilot = (
    <Copilot projectSlug={slug} nodeKind="feat" cards={copilotCards(data, stage, !!brief)} pending={stage === 'drafting'}
      extraSlot={stage === 'done' ? <FollowUpsPanel node="feat" items={data.items} /> : null} />
  );
  if (!data.loading && !brief) return <NodeFrame copilot={copilot}><MissingFeatUpstream /></NodeFrame>;
  return (
    <NodeFrame wide copilot={copilot} redo={[{
      label: '重新起草功能列表', node: 'feat', types: ['feature', 'pillar', 'not_doing'], run: draft, busy: running,
    }]}>
      <NodeHat kind="feat" chip={STAGE_CHIP[stage]} />
      <h1 className="node-title">{TITLE}</h1>
      <p className="node-intro">
        §九 要求把前面所有分析<em>收口</em>成"可执行的假设清单"。
        我会产出<em>金字塔结构</em>、<em>Kano 五分类</em>、<em>RICE 评分</em>、
        <em>五问法</em>、<em>功能卡片即假设</em>、以及<em>不做什么清单</em>。每个功能都带来源追溯。
      </p>
      <StoreStatus data={data} />
      {data.loading ? null : <UpstreamStatus data={data} />}
      {stage === 'idle' && brief ? <CenteredAction label="基于上游产出起草功能列表 →" onClick={draft} /> : null}
      {stage === 'drafting' ? <LoadingCard>收口中 · 同时计算 Kano/RICE/五问法/功能卡片，通常 90-180 秒……</LoadingCard> : null}
      <ErrorCard message={error} />
      {stage === 'done' ? <FeatResults data={data} onRedraft={draft} /> : null}
    </NodeFrame>
  );
}

function MissingFeatUpstream() {
  return (
    <MissingUpstream kind="feat" chip={STAGE_CHIP.idle} title={TITLE} heading="缺少上游上下文">
      <p>
        请先完成 <NodeLink kind="brief">Brief</NodeLink>、<NodeLink kind="users">用户与任务</NodeLink> 和{' '}
        <NodeLink kind="scen">情景分析</NodeLink>。
      </p>
    </MissingUpstream>
  );
}

function UpstreamStatus({ data }: { data: NodeData }) {
  const u = upstreamOf(data);
  const chips = [
    { label: '设计启发', count: u.insights.length, need: true },
    { label: '锁定 Job', count: u.jobs.length, need: true },
    { label: 'persona', count: u.personas.length, need: true },
    { label: '深入情景', count: u.scenarios.length, need: false },
    { label: '差异化假设', count: u.diff ? 1 : 0, need: false },
  ];
  return (
    <div className="para-section">
      <div className="upstream-status">
        {chips.map((c) => (
          <div key={c.label} className={`upstream-chip ${c.count === 0 && c.need ? 'warn' : c.count > 0 ? 'ok' : 'dim'}`}>
            <span className="upstream-chip-label">{c.label}</span>
            <span className="upstream-chip-count">{c.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FeatResults({ data, onRedraft }: { data: NodeData; onRedraft: () => void }) {
  const pillars = data.of('pillar');
  const features = data.of('feature');
  const notDoing = data.of('not_doing');
  return (
    <>
      <JudgeBar node="feat" judged={['feature', 'not_doing']} />
      <div className="para-section">
        <ParaHead title="金字塔支柱" hint={`${pillars.length} 个 · §9.1 同层 ≤ 7`} />
        <PillarsStrip pillars={pillars} features={features} />
      </div>
      <div className="para-section">
        <ParaHead title="功能清单" hint="点卡片展开五问法 + 功能卡片" />
        <FeaturePyramid pillars={pillars} features={features} links={data.links} all={data.all} />
      </div>
      <div className="para-section">
        <ParaHead title="不做什么（§9.6）" hint={`${notDoing.length} 条 · 防止范围蔓延`} />
        <NotDoingList items={notDoing} />
      </div>
      <div className="para-section">
        <ParaHead title="差异化假设回响" hint="§七 → §九 的对账" />
        <div className="diff-echo"><div className="diff-echo-quote">{summaryText(data.items, 'differentiation_echo')}</div></div>
      </div>
      <div className="para-section" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <ContinueButton node="feat" />
        <button type="button" className="btn btn-ghost" onClick={onRedraft}>重新起草</button>
      </div>
    </>
  );
}
