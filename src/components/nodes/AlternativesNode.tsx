'use client';

import { useMemo } from 'react';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { useProject } from '@/components/project/ProjectStore';
import { useAiAction } from '@/components/project/useAiAction';
import { useNodeData, type NodeData } from '@/components/project/useNodeData';
import { critiqueCards } from '@/components/shared/copilot-cards';
import { FollowUpsPanel } from '@/components/shared/FollowUpsPanel';
import { JudgeBar } from '@/components/shared/JudgeBar';
import { ContinueButton, MissingUpstream, NodeLink } from '@/components/shared/Navigation';
import {
  CenteredAction, confirmSingletonOverwrite, ErrorCard, LoadingCard, NodeFrame, NodeHat, ParaHead,
} from '@/components/shared/NodeKit';
import { UpstreamContext } from '@/components/shared/UpstreamContext';
import { adaptAlternatives } from '@/lib/model/adapters';
import { briefRequestContext, inputsOf, type BriefRequestContext } from '@/lib/model/context';
import { buildFeedback } from '@/lib/model/feedback';
import { briefPayload, jobPayload, personaPayload } from '@/lib/store/request-context';
import { AlternativesOverview, FeatureBreakdowns, StrategicProfiles } from './alt/AltCards';
import { ThreatsAndDiff } from './alt/ThreatsAndDiff';

type Stage = 'idle' | 'analyzing' | 'done';

const TITLE = '替代方案：真正的对手常常不是直接竞品';
const STAGE_CHIP: Record<Stage, string> = { idle: '替代方案 · 预计 25 分钟', analyzing: '联网扫描中…', done: '已扫描 · 可重跑' };

function useAltScan(data: NodeData, brief: BriefRequestContext | null) {
  const { slug } = useProject();
  const ai = useAiAction();
  const analyze = () => {
    if (!brief) return;
    if (!confirmSingletonOverwrite(data.of('diff_hypothesis')[0], '差异化假设')) return;
    const personas = data.context('users', 'persona');
    const jobs = data.context('users', 'job');
    void ai.run('scan', {
      route: '/api/ai/analyze-alternatives',
      body: {
        projectSlug: slug,
        ...briefPayload(brief),
        personas: personas.map(personaPayload),
        lockedJobs: jobs.map((j) => jobPayload(j, data.links)),
        feedback: buildFeedback(data.all, [{ node: 'alt', type: 'alternative' }]),
      },
      node: 'alt',
      inputs: inputsOf(brief.items, personas, jobs),
      adapt: adaptAlternatives,
    });
  };
  return { analyze, running: ai.running !== null, error: ai.error };
}

function doneCards(data: NodeData): CopilotCard[] {
  const alternatives = data.of('alternative');
  const hypothesis = data.of('diff_hypothesis')[0]?.body;
  const nonConsumption = alternatives.filter((a) => a.body.category === 'non_consumption').length;
  return [
    {
      tag: 'feed',
      title: `识别到 ${alternatives.length} 个替代方案`,
      body: (
        <>
          其中 <b>{nonConsumption} 条非消费替代</b>——方法论说这些才是真正的对手。
          前 3 威胁：{(hypothesis?.key_threats ?? []).slice(0, 3).join(' · ')}
        </>
      ),
    },
    ...(hypothesis
      ? [{
        tag: 'ask' as const,
        title: '差异化假设就绪',
        body: (
          <>
            一句话版本：<b>{hypothesis.statement}</b>
            <div className="dim" style={{ marginTop: 6, fontSize: 12 }}>
              这句话经得起"找 3 个没参与项目的同事念 10 秒然后用自己话复述"的测试吗？
            </div>
          </>
        ),
      }]
      : []),
    ...critiqueCards(data.items),
  ];
}

function copilotCards(data: NodeData, stage: Stage, hasBrief: boolean): CopilotCard[] {
  if (!hasBrief) return [{ tag: 'check', title: '需要 Brief 上下文', body: '请先完成 Brief 节点，替代方案节点才能运作。' }];
  if (stage === 'idle') {
    return [{
      tag: 'feed',
      title: '准备好做 §7 替代方案扫描',
      body: (
        <>
          我会<em>联网搜索</em>查找真实的直接 / 间接替代品，并推理 <em>非消费替代</em>
          （用户懒得解决这个问题的各种方式）。<br />
          然后对重点对手按 <em>战略三问</em>（承诺 / 赢利模式 / 护城河）做深度画像，
          最后给你一句"差异化假设"。通常 <b>60-120 秒</b>。
        </>
      ),
    }];
  }
  if (stage === 'analyzing') {
    return [{ tag: 'feed', title: '联网扫描中…', body: '正在检索真实产品信息。这步比较慢，AI 要读多个网页，通常 1-2 分钟。' }];
  }
  return doneCards(data);
}

export function AlternativesNode() {
  const { slug } = useProject();
  const data = useNodeData('alt');
  const brief = useMemo(() => briefRequestContext(data.all), [data.all]);
  const { analyze, running, error } = useAltScan(data, brief);
  const stage: Stage = running ? 'analyzing' : data.of('alternative').length > 0 ? 'done' : 'idle';
  const copilot = (
    <Copilot
      projectSlug={slug} nodeKind="alt" cards={copilotCards(data, stage, !!brief)} pending={stage === 'analyzing'}
      extraSlot={stage === 'done' ? <FollowUpsPanel node="alt" items={data.items} /> : null}
    />
  );
  if (!data.loading && !brief) return <NodeFrame copilot={copilot}><MissingAltUpstream /></NodeFrame>;
  return (
    <NodeFrame wide copilot={copilot}>
      <NodeHat kind="alt" chip={STAGE_CHIP[stage]} />
      <h1 className="node-title">{TITLE}</h1>
      <p className="node-intro">
        你的产品要打败的不只是<em>同品类对手</em>。最常被忽视的是<em>非消费替代</em>——
        用户干脆不解决这个问题、或用原始方式凑合（"懒得用"、"抄答案"、"问家长"）。
        我会联网扫描真实对手，并按 §7.2 战略三问（<em>承诺 / 赢利模式 / 护城河</em>）画像。
      </p>
      {data.loading ? <LoadingCard>正在读取项目数据…</LoadingCard> : null}
      {brief ? <AltUpstream data={data} brief={brief} /> : null}
      {stage === 'idle' && brief ? <CenteredAction label="开始联网扫描 →" onClick={analyze} /> : null}
      {stage === 'analyzing' ? <LoadingCard>正在联网扫描真实替代品（会读多个网页）· 通常 60-120 秒……</LoadingCard> : null}
      <ErrorCard message={error} />
      {stage === 'done' ? <AltResults data={data} onRescan={analyze} /> : null}
    </NodeFrame>
  );
}

function MissingAltUpstream() {
  return (
    <MissingUpstream kind="alt" chip={STAGE_CHIP.idle} title={TITLE} heading="缺少 Brief 上下文">
      <p>
        请先完成 <NodeLink kind="brief">Brief</NodeLink>，可选择也完成{' '}
        <NodeLink kind="users">用户与任务</NodeLink>（会让分析更精准）。
      </p>
    </MissingUpstream>
  );
}

function AltUpstream({ data, brief }: { data: NodeData; brief: BriefRequestContext }) {
  const completeness = data.of('brief', 'brief')[0]?.body.completeness ?? 0;
  const personas = data.context('users', 'persona').length;
  const jobs = data.context('users', 'job').length;
  return <UpstreamContext brief={brief} summary={`上游快照 · Brief ${completeness}% · ${personas} personas · ${jobs} jobs`} />;
}

function AltResults({ data, onRescan }: { data: NodeData; onRescan: () => void }) {
  const alternatives = data.of('alternative');
  const profiles = data.of('alt_profile');
  const breakdowns = data.of('alt_breakdown');
  const hypothesis = data.of('diff_hypothesis')[0];
  return (
    <>
      <JudgeBar node="alt" judged={['alternative', 'diff_hypothesis']} />
      <div className="para-section">
        <ParaHead title="三类替代全景" hint={`${alternatives.length} 个 · 非消费 ★ 最关键`} />
        <AlternativesOverview alternatives={alternatives} />
      </div>
      <div className="para-section">
        <ParaHead title="重点对手战略画像" hint={`§7.2 战略三问 · ${profiles.length} 个`} />
        <StrategicProfiles alternatives={alternatives} profiles={profiles} links={data.links} />
      </div>
      {breakdowns.length > 0 ? (
        <div className="para-section">
          <ParaHead title="直接竞品功能拆解" hint={`§7.3 四角度 · ${breakdowns.length} 个`} />
          <FeatureBreakdowns alternatives={alternatives} breakdowns={breakdowns} links={data.links} />
        </div>
      ) : null}
      {hypothesis ? (
        <div className="para-section">
          <ParaHead title="核心威胁 & 差异化假设" hint="一句话说清凭什么赢" />
          <ThreatsAndDiff hypothesis={hypothesis} />
        </div>
      ) : null}
      <div className="para-section" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <ContinueButton node="alt" label="继续 · 05 情景 →" />
        <button type="button" className="btn btn-ghost" onClick={onRescan}>重新扫描</button>
      </div>
    </>
  );
}
