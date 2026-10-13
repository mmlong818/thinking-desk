'use client';

import { useMemo } from 'react';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { useProject } from '@/components/project/ProjectStore';
import { useNodeData, type NodeData } from '@/components/project/useNodeData';
import { critiqueCards, summaryText } from '@/components/shared/copilot-cards';
import { FollowUpsPanel } from '@/components/shared/FollowUpsPanel';
import { JudgeBar } from '@/components/shared/JudgeBar';
import { ContinueButton, MissingUpstream, NodeLink } from '@/components/shared/Navigation';
import {
  CenteredAction, ErrorCard, LoadingCard, NodeFrame, NodeHat, ParaHead, StoreStatus,
} from '@/components/shared/NodeKit';
import { briefRequestContext } from '@/lib/model/context';
import { BriefContextCard } from './users/BriefContextCard';
import { JobGroup, JobsRefreshBar, LockedSummary } from './users/JobsSection';
import { PersonaGrid } from './users/PersonaGrid';
import { useUsersActions } from './users/useUsersActions';
import { GROUP_META, jobsBasis, MAX_PERSONAS, type JobGroupKey } from './users/users-meta';

type Stage = 'idle' | 'analyzing' | 'done';
type Actions = ReturnType<typeof useUsersActions>;

const TITLE = '用户与任务：她到底要"雇"谁做什么事';
const STAGE_CHIP: Record<Stage, string> = { idle: 'JTBD · 预计 25 分钟', analyzing: '分析中…', done: '已分析 · 可继续生成 / 采纳' };

function doneCards(data: NodeData, adding: boolean): CopilotCard[] {
  const personas = data.of('persona').filter((p) => p.decision !== 'rejected');
  const accepted = personas.filter((p) => p.decision === 'accepted').length;
  const cards: CopilotCard[] = [
    {
      tag: 'feed',
      title: adding ? '正在生成新一批…' : `当前 ${personas.length} 个 persona · ${accepted} 个已采纳`,
      body: summaryText(data.items, 'priority'),
    },
    ...critiqueCards(data.items),
  ];
  if (personas.length < MAX_PERSONAS && !adding) {
    cards.push({
      tag: 'ask',
      title: '再生成 3 个？',
      body: <>已采纳的角色会保留并作为参考，新的 3 个会<em>刻意避开已有维度</em>。当前 {personas.length} / {MAX_PERSONAS}。</>,
    });
  }
  return cards;
}

function copilotCards(data: NodeData, stage: Stage, hasBrief: boolean, adding: boolean): CopilotCard[] {
  if (!hasBrief) {
    return [{ tag: 'check', title: '当前节点在等 Brief', body: '每一个节点都会读前面节点的输出，保证分析的一致性。完成 Brief 后回来点"开始分析"即可。' }];
  }
  if (stage === 'idle') {
    return [{
      tag: 'feed',
      title: '准备好分析用户与 Job',
      body: <>我已读完 Brief。点"开始分析"，我会一次产出 <b>3 个差异化 persona</b> + 三类 JTBD 清单。<em>不满意的可以让我再补，上限 10 个</em>。</>,
    }];
  }
  if (stage === 'analyzing') return [{ tag: 'feed', title: '分析中…', body: '通常 20–60 秒。推理模型会同时做多个维度拆解。' }];
  return doneCards(data, adding);
}

export function UsersNode() {
  const { slug } = useProject();
  const data = useNodeData('users');
  const ctx = useMemo(() => briefRequestContext(data.all), [data.all]);
  const actions = useUsersActions(data, ctx);
  const stage: Stage = actions.running === 'analyze' ? 'analyzing' : data.of('persona').length > 0 ? 'done' : 'idle';
  const cards = copilotCards(data, stage, !!ctx, actions.running === 'add');
  const copilot = (
    <Copilot
      projectSlug={slug} nodeKind="users" cards={cards} pending={stage === 'analyzing'}
      extraSlot={stage === 'done' ? <FollowUpsPanel node="users" items={data.items} /> : null}
    />
  );
  if (!data.loading && !ctx) return <NodeFrame copilot={copilot}><MissingBrief /></NodeFrame>;
  const brief = data.of('brief', 'brief')[0];
  const busy = actions.running !== null;
  const redo = [
    { label: '基于当前画像刷新 Jobs', types: ['job'] as const, run: actions.refreshJobs, busy },
    { label: '全部重新分析', types: ['persona'] as const, run: actions.analyze, busy },
  ];
  return (
    <NodeFrame copilot={copilot} redo={redo}>
      <NodeHat kind="users" chip={STAGE_CHIP[stage]} />
      <h1 className="node-title">{TITLE}</h1>
      <p className="node-intro">
        不要先想"做什么功能"，<em>先想用户在哪个处境下雇了一个工具做什么 Job</em>。
        一个产品通常要<em>同时服务多个典型用户</em> —— 我先给你 3 个差异化 persona，
        默认全部选中作为产品覆盖对象，你可以取消不相关的，也可以让我再生成新的（上限 10 个）。
      </p>
      <StoreStatus data={data} />
      {ctx && brief ? <BriefContextCard ctx={ctx} brief={brief} /> : null}
      {stage === 'idle' && ctx ? <CenteredAction label="基于 Brief 开始分析 →" onClick={actions.analyze} /> : null}
      {stage === 'analyzing' ? <LoadingCard>正在拆解 3 个 persona + 三类 Job，通常 20–60 秒……</LoadingCard> : null}
      <ErrorCard message={actions.error} />
      {stage === 'done' ? <UsersResults data={data} actions={actions} /> : null}
    </NodeFrame>
  );
}

function MissingBrief() {
  return (
    <MissingUpstream kind="users" chip={STAGE_CHIP.idle} title={TITLE} heading="还没有 Brief 上下文">
      <p>
        Brief 节点产出的问题陈述、用户、场景、价值主张，会作为 JTBD 分析的输入。
        <br />
        请先去 <NodeLink kind="brief">Brief 节点</NodeLink> 粘贴原始需求并完成澄清。
      </p>
    </MissingUpstream>
  );
}

function UsersResults({ data, actions }: { data: NodeData; actions: Actions }) {
  return (
    <>
      <JudgeBar node="users" judged={['persona', 'job']} />
      <PersonasSection data={data} actions={actions} />
      <JobsListSection data={data} actions={actions} />
      <div className="para-section">
        <ParaHead title="优先级锁定" hint="已采纳的 Job 将成为功能列表的总纲" />
        <LockedSummary jobs={data.of('job')} />
      </div>
      <div className="para-section" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <ContinueButton node="users" label="继续 · 03 干系人 →" />
        <button type="button" className="btn btn-ghost" onClick={actions.analyze} disabled={actions.running !== null}>全部重新分析</button>
      </div>
    </>
  );
}

function PersonasSection({ data, actions }: { data: NodeData; actions: Actions }) {
  const personas = data.of('persona');
  const live = personas.filter((p) => p.decision !== 'rejected');
  const accepted = live.filter((p) => p.decision === 'accepted').length;
  const busy = actions.running === 'add' || actions.running === 'refine';
  const full = live.length >= MAX_PERSONAS;
  return (
    <div className="para-section">
      <ParaHead title="用户画像库" hint={`${live.length} / ${MAX_PERSONAS} · ${accepted} 已选`} />
      <PersonaGrid personas={personas} />
      <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
        <button type="button" className="btn btn-ghost" onClick={actions.addMore} disabled={busy || full || actions.running !== null}>
          {actions.running === 'add' ? <><span className="ai-spinner" />&nbsp; 生成新 persona…</>
            : actions.running === 'refine' ? <><span className="ai-spinner" />&nbsp; 同步刷新 Jobs…</>
              : full ? '已达 10 个上限' : `+ 再生成 3 个（当前 ${live.length}）`}
        </button>
        <span className="dim" style={{ fontSize: 12 }}>
          新 persona 会<b style={{ color: 'var(--ink-3)' }}>自动加入</b>并<b style={{ color: 'var(--ink-3)' }}>联动刷新 Jobs</b> · 已采纳的角色保留
        </span>
      </div>
    </div>
  );
}

function JobsListSection({ data, actions }: { data: NodeData; actions: Actions }) {
  const personas = data.of('persona');
  const jobs = data.of('job');
  const accepted = jobs.filter((j) => j.decision === 'accepted').length;
  return (
    <div className="para-section">
      <ParaHead title="Jobs-to-be-done 清单" hint={`采纳为"优先" · ${accepted} 个已采纳`} />
      <JobsRefreshBar
        selection={data.context('users', 'persona')}
        basis={jobsBasis(jobs, personas, data.runs)}
        refreshing={actions.running === 'refine'}
        onRefresh={actions.refreshJobs}
      />
      {(Object.keys(GROUP_META) as JobGroupKey[]).map((g) => (
        <JobGroup key={g} group={g} jobs={jobs.filter((j) => j.body.dimension === g)} personas={personas} links={data.links} />
      ))}
    </div>
  );
}
