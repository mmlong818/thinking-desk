'use client';

import { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { useProject } from '@/components/project/ProjectStore';
import { useNodeData, type NodeData } from '@/components/project/useNodeData';
import { critiqueCards, summaryItem, summaryText } from '@/components/shared/copilot-cards';
import { FollowUpsPanel } from '@/components/shared/FollowUpsPanel';
import { JudgeBar } from '@/components/shared/JudgeBar';
import { MissingUpstream, NodeLink } from '@/components/shared/Navigation';
import {
  CenteredAction, ErrorCard, NodeFrame, NodeHat, StoreStatus,
} from '@/components/shared/NodeKit';
import { StreamProgressCard } from '@/components/shared/StreamProgress';
import { briefRequestContext } from '@/lib/model/context';
import { ApplyLeapsSection, type RevisionView } from './leap/ApplyLeaps';
import { CategorySection } from './leap/LeapCards';
import { TimingCard, UserPicksSection } from './leap/LeapPicks';
import { LEAP_TYPES, TIMING_META, type LeapItem, type LeapType } from './leap/leap-meta';
import { useLeapActions } from './leap/useLeapActions';

type Stage = 'idle' | 'analyzing' | 'done';
type Actions = ReturnType<typeof useLeapActions>;

const TITLE = '创造性跃迁：设计真正开始的地方';
const STAGE_CHIP: Record<Stage, string> = { idle: '★ 设计真正开始的地方', analyzing: '思考跃迁中…', done: '已生成 · 可采纳 / 否决' };

/** Card label per running action key (`more:<type>` shares `more`). */
const RUNNING_LABEL: Record<string, string> = {
  more: '再补 3 条候选中',
  revise: '应用跃迁中 · 产出 08 最终功能列表',
};

const leapsOf = (data: NodeData) => LEAP_TYPES.flatMap((t) => data.of(t)) as LeapItem[];

function revisionOf(data: NodeData): RevisionView | null {
  const revisions = data.of('revision', 'final');
  if (revisions.length === 0) return null;
  const finalItems = data.all.filter((i) => i.node === 'final');
  return { revisions, summary: summaryText(finalItems, 'revision'), echo: summaryText(finalItems, 'differentiation_echo') };
}

function doneCard(data: NodeData): CopilotCard[] {
  const timing = summaryItem(data.items, 'leap_timing');
  const verdict = timing?.body.verdict ?? 'selective';
  const leaps = leapsOf(data);
  const picked = leaps.filter((l) => l.decision === 'accepted').length;
  const recommended = leaps.filter((l) => l.aiStance?.verdict === 'recommend').length;
  return [{
    tag: verdict === 'bold' ? 'critique' : verdict === 'selective' ? 'ask' : 'check',
    title: `胆量级别：${TIMING_META[verdict].label}`,
    body: (
      <>
        {timing?.body.text}
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
          你已<em>采纳</em> <b>{picked}</b> 条 · AI 推荐 {recommended} 条。
          采纳的跃迁会被应用到功能列表；<em>否决</em>的方向在"再补 3 条"时会被避开。
        </div>
      </>
    ),
  }];
}

function copilotCards(data: NodeData, stage: Stage, hasBrief: boolean): CopilotCard[] {
  if (!hasBrief) return [{ tag: 'check', title: '需要 Brief', body: '请先完成 Brief 节点' }];
  if (stage === 'analyzing') return [{ tag: 'feed', title: '思考跃迁角度…', body: '三种方法同时拆，20+ 条候选，通常 90-180 秒。' }];
  if (stage === 'done') return [...doneCard(data), ...critiqueCards(data.items)];
  return [{
    tag: 'critique',
    title: '★ 设计真正从这里开始',
    body: (
      <>
        上一步的<em>功能列表</em>只是"基于前面分析的市场常规方案"——把需求翻译成行业标准模板。<em>还没有设计</em>。
        <div style={{ marginTop: 8 }}>
          <b>本节点决定了产品最终有没有差异化</b>：哪些点上我们不照抄常规？哪些假设可以被推翻？没有跃迁的产品 = 交付常规方案，不叫设计。
        </div>
      </>
    ),
  }];
}

export function LeapNode() {
  const { slug } = useProject();
  const data = useNodeData('leap');
  const brief = useMemo(() => briefRequestContext(data.all), [data.all]);
  const actions = useLeapActions(data, brief);
  const stage: Stage = actions.running === 'analyze' ? 'analyzing' : leapsOf(data).length > 0 ? 'done' : 'idle';
  const copilot = (
    <Copilot projectSlug={slug} nodeKind="leap" cards={copilotCards(data, stage, !!brief)} pending={stage === 'analyzing'}
      extraSlot={stage === 'done' ? <FollowUpsPanel node="leap" items={data.items} /> : null} />
  );
  if (!data.loading && !brief) return <NodeFrame copilot={copilot}><MissingLeapUpstream /></NodeFrame>;
  return (
    <NodeFrame wide copilot={copilot} redo={[
      { label: '重新跃迁分析', types: LEAP_TYPES, run: actions.run, busy: actions.running !== null },
      {
        label: '重新应用跃迁', node: 'final', types: ['feature', 'pillar', 'not_doing', 'revision'],
        run: actions.revise, busy: actions.running !== null,
      },
    ]}>
      <NodeHat kind="leap" chip={STAGE_CHIP[stage]} />
      <h1 className="node-title">{TITLE}</h1>
      <p className="node-intro">
        上一步的<em>功能列表</em>只是"市场常规方案的能力罗列"——把需求翻译成行业标准模板，<em>还没有设计</em>。
        本节点回答：<em>哪些点上我们不照抄常规？哪些假设可以被推翻？</em>
        从<em>第一性原理 / 类比迁移 / 约束反转</em>三角度给候选。
        <br />
        <b>✓ 采纳</b>：决定哪些跃迁会被应用到功能列表。
        <b>✗ 否决</b>：下次再补时避开该方向（可以写下理由）。
      </p>
      <StoreStatus data={data} />
      {stage === 'idle' && brief ? <CenteredAction label="生成跃迁候选 →" onClick={actions.run} /> : null}
      {stage === 'analyzing' ? <StreamProgressCard label="同时从三角度思考 · 20+ 条候选" progress={actions.progress} onCancel={actions.cancel} /> : null}
      <ErrorCard message={actions.error} />
      {stage === 'done' ? <LeapResults data={data} actions={actions} slug={slug} /> : null}
    </NodeFrame>
  );
}

function MissingLeapUpstream() {
  return (
    <MissingUpstream kind="leap" chip={STAGE_CHIP.idle} title={TITLE} heading="缺少 Brief 上下文">
      <p>
        请先完成 <NodeLink kind="brief">Brief</NodeLink>。建议一起完成 <NodeLink kind="feat">06 功能列表</NodeLink>
        ——没有功能列表，跃迁没有对照目标。
      </p>
    </MissingUpstream>
  );
}

const SECTIONS: { type: LeapType; num: string; title: string; hint: (n: number) => string }[] = [
  { type: 'first_principle', num: '§ 1', title: '第一性原理（§10.1）', hint: (n) => `剥离行业惯例 · ${n} 条` },
  { type: 'analogy', num: '§ 2', title: '类比迁移（§10.2）', hint: (n) => `跨领域搬运成熟结构 · ${n} 条` },
  { type: 'constraint_flip', num: '§ 3', title: '约束反转与极端化（§10.3）', hint: (n) => `改变一个前提 · ${n} 条` },
];

function LeapResults({ data, actions, slug }: { data: NodeData; actions: Actions; slug: string }) {
  const timing = summaryItem(data.items, 'leap_timing');
  const leaps = leapsOf(data);
  const revision = revisionOf(data);
  const revising = actions.running === 'revise';
  const progress = actions.running
    ? <StreamProgressCard label={RUNNING_LABEL[actions.running.split(':')[0]] ?? 'AI 生成中'} progress={actions.progress} onCancel={actions.cancel} />
    : null;
  return (
    <>
      {timing ? <TimingCard timing={timing} /> : null}
      <JudgeBar node="leap" judged={[...LEAP_TYPES]} />
      {SECTIONS.map((s) => {
        const items = data.of(s.type) as LeapItem[];
        return (
          <CategorySection
            key={s.type} num={s.num} title={s.title} hint={s.hint(items.length)} items={items}
            regenerating={actions.running === `more:${s.type}`} disabled={actions.running !== null}
            onRegenerate={() => actions.more(s.type)} progress={progress}
          />
        );
      })}
      <UserPicksSection leaps={leaps} />
      <ApplyLeapsSection
        leaps={leaps} revision={revision} revising={revising} hasOriginalFeat={data.of('feature', 'feat').length > 0}
        links={data.links} slug={slug} onApply={() => void actions.revise()} progress={progress}
      />
      <LeapFooter revising={revising} hasRevision={!!revision} onRegenerate={actions.run} slug={slug} />
    </>
  );
}

function LeapFooter({ revising, hasRevision, onRegenerate, slug }: { revising: boolean; hasRevision: boolean; onRegenerate: () => void; slug: string }) {
  const router = useRouter();
  return (
    <div className="para-section" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <button
        type="button"
        className="btn btn-accent"
        disabled={revising || !hasRevision}
        onClick={() => router.push(`/project/${slug}/final`)}
        title={revising ? '修订中 · 完成后可继续' : !hasRevision ? '先应用跃迁生成修订版，才能进入 08' : undefined}
      >
        启动 · 08 设计案 →
      </button>
      <button type="button" className="btn btn-ghost" onClick={onRegenerate} disabled={revising}>全部重新生成</button>
      {!hasRevision && !revising ? <span className="dim" style={{ fontSize: 12 }}>完成上方修订后即可启动 08 设计案</span> : null}
    </div>
  );
}
