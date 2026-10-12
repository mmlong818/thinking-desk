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
  CenteredAction, confirmSingletonOverwrite, ErrorCard, LoadingCard, NodeFrame, NodeHat, ParaHead,
} from '@/components/shared/NodeKit';
import { PersonaContextList, UpstreamContext } from '@/components/shared/UpstreamContext';
import { adaptStakeholders } from '@/lib/model/adapters';
import { briefRequestContext, inputsOf, type BriefRequestContext } from '@/lib/model/context';
import { buildFeedback } from '@/lib/model/feedback';
import { briefPayload, jobPayload, personaPayload } from '@/lib/store/request-context';
import { EngagementPlanCards, MendelowMatrix, StakeholderList } from './stake/StakeMatrix';

type Stage = 'idle' | 'analyzing' | 'done';

const TITLE = '干系人：谁会推动你、谁会阻挡你';
const STAGE_CHIP: Record<Stage, string> = {
  idle: 'Mendelow 矩阵 · 预计 20 分钟',
  analyzing: '分析中…',
  done: '已分析 · 可编辑 / 选择',
};

function useStakeAnalysis(data: NodeData, brief: BriefRequestContext | null) {
  const { slug } = useProject();
  const ai = useAiAction();
  const analyze = () => {
    if (!brief) return;
    if (!confirmSingletonOverwrite(data.of('engagement_plan')[0], '四象限沟通节奏')) return;
    const personas = data.context('users', 'persona');
    const jobs = data.context('users', 'job');
    void ai.run('analyze', {
      route: '/api/ai/analyze-stakeholders',
      body: {
        projectSlug: slug,
        ...briefPayload(brief),
        personas: personas.map(personaPayload),
        lockedJobs: jobs.map((j) => jobPayload(j, data.links)),
        feedback: buildFeedback(data.all, [{ node: 'stake', type: 'stakeholder' }]),
      },
      node: 'stake',
      inputs: inputsOf(brief.items, personas, jobs),
      adapt: adaptStakeholders,
    });
  };
  return { analyze, running: ai.running !== null, error: ai.error };
}

function copilotCards(data: NodeData, stage: Stage, hasBrief: boolean): CopilotCard[] {
  if (!hasBrief) {
    return [{ tag: 'check', title: '等 Brief 和用户节点完成', body: '干系人分析需要前两个节点的产出。请先完成 Brief 和用户与任务节点。' }];
  }
  if (stage === 'idle') {
    const personas = data.context('users', 'persona').length;
    const jobs = data.context('users', 'job').length;
    return [{
      tag: 'feed',
      title: '准备好做 Mendelow 分析',
      body: (
        <>
          我会读 Brief 上下文，以及你在用户与任务节点锁定的 <b>{personas} 个 persona</b> 和 <b>{jobs} 个 Job</b>，
          产出 8–12 个干系人，<em>其中 5 个基线角色（发起人 / 设计团队 / 业务方 / 合规 / 用户）必选不可删</em>，
          其余按 Brief 推导。
        </>
      ),
    }];
  }
  if (stage === 'analyzing') {
    return [{ tag: 'feed', title: '分析中…', body: '通常 30–60 秒。要判断每个干系人在权力×关心二维上的位置。' }];
  }
  const count = data.of('stakeholder').length;
  return [
    { tag: 'feed', title: `识别到 ${count} 个干系人`, body: summaryText(data.items, 'priority') },
    ...critiqueCards(data.items),
  ];
}

export function StakeholdersNode() {
  const { slug } = useProject();
  const data = useNodeData('stake');
  const brief = useMemo(() => briefRequestContext(data.all), [data.all]);
  const { analyze, running, error } = useStakeAnalysis(data, brief);
  const stakeholders = data.of('stakeholder');
  const stage: Stage = running ? 'analyzing' : stakeholders.length > 0 ? 'done' : 'idle';
  const cards = copilotCards(data, stage, !!brief);

  if (!data.loading && !brief) {
    return (
      <NodeFrame copilot={<Copilot projectSlug={slug} nodeKind="stake" cards={cards} />}>
        <MissingStakeUpstream />
      </NodeFrame>
    );
  }
  return (
    <NodeFrame
      wide
      copilot={
        <Copilot
          projectSlug={slug} nodeKind="stake" cards={cards} pending={stage === 'analyzing'}
          extraSlot={stage === 'done' ? <FollowUpsPanel node="stake" items={data.items} /> : null}
        />
      }
    >
      <NodeHat kind="stake" chip={STAGE_CHIP[stage]} />
      <h1 className="node-title">{TITLE}</h1>
      <p className="node-intro">
        每个项目都有<em>显性和隐性的干系人</em>。我把他们放进 Mendelow 2×2 矩阵，
        其中<em>基线角色</em>（发起人、设计团队、你背后的业务方、合规、用户）<em>始终必选不可删</em>，
        项目专属的干系人你可以自由调整。
      </p>
      {data.loading ? <LoadingCard>正在读取项目数据…</LoadingCard> : null}
      {brief ? <StakeUpstream data={data} brief={brief} /> : null}
      {stage === 'idle' && brief ? <CenteredAction label="基于 Brief + 用户节点开始分析 →" onClick={analyze} /> : null}
      {stage === 'analyzing' ? <LoadingCard>正在拆解 Mendelow 矩阵，通常 30–60 秒……</LoadingCard> : null}
      <ErrorCard message={error} />
      {stage === 'done' ? <StakeResults data={data} onReanalyze={analyze} /> : null}
    </NodeFrame>
  );
}

function MissingStakeUpstream() {
  return (
    <MissingUpstream kind="stake" chip={STAGE_CHIP.idle} title={TITLE} heading="缺少前置节点">
      <p>
        先完成 <NodeLink kind="brief">Brief</NodeLink> 和 <NodeLink kind="users">用户与任务</NodeLink>，再回来。
      </p>
    </MissingUpstream>
  );
}

function StakeUpstream({ data, brief }: { data: NodeData; brief: BriefRequestContext }) {
  const personas = data.context('users', 'persona');
  const jobs = data.context('users', 'job');
  const completeness = data.of('brief', 'brief')[0]?.body.completeness ?? 0;
  return (
    <UpstreamContext
      brief={brief}
      summary={`上游上下文 · Brief ${completeness}% · ${personas.length} personas · ${jobs.length} jobs`}
    >
      <PersonaContextList personas={personas} />
    </UpstreamContext>
  );
}

function StakeResults({ data, onReanalyze }: { data: NodeData; onReanalyze: () => void }) {
  const stakeholders = data.of('stakeholder');
  const plan = data.of('engagement_plan')[0];
  const accepted = stakeholders.filter((s) => s.decision === 'accepted').length;
  const required = stakeholders.filter((s) => s.body.required).length;
  return (
    <>
      <JudgeBar node="stake" judged={['stakeholder', 'engagement_plan']} />
      <div className="para-section">
        <ParaHead title="Mendelow 2×2 矩阵" hint={`${stakeholders.length} 个 · ${accepted} 已选 · ${required} 基线必选`} />
        <MendelowMatrix stakeholders={stakeholders} />
      </div>
      <div className="para-section">
        <ParaHead title="干系人详情" hint="完整信息 · 可否决非必选" />
        <StakeholderList stakeholders={stakeholders} />
      </div>
      {plan ? (
        <div className="para-section">
          <ParaHead title="四象限沟通节奏" hint="AI 建议 · 可在评审里调整" />
          <EngagementPlanCards plan={plan} />
        </div>
      ) : null}
      <div className="para-section" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <ContinueButton node="stake" label="继续 · 04 替代方案 →" />
        <button type="button" className="btn btn-ghost" onClick={onReanalyze}>重新分析</button>
      </div>
    </>
  );
}
