'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { useProject } from '@/components/project/ProjectStore';
import { useAiAction } from '@/components/project/useAiAction';
import { useItemActions } from '@/components/project/useItemActions';
import { useNodeData, type NodeData } from '@/components/project/useNodeData';
import { summaryItem } from '@/components/shared/copilot-cards';
import { EditableText } from '@/components/shared/Editable';
import { FollowUpsPanel } from '@/components/shared/FollowUpsPanel';
import { JudgeBar } from '@/components/shared/JudgeBar';
import { MissingUpstream, NodeLink } from '@/components/shared/Navigation';
import { ErrorCard, NodeFrame, NodeHat, StoreStatus } from '@/components/shared/NodeKit';
import { adaptSubfeatureBreakdown } from '@/lib/model/adapters';
import { inputsOf } from '@/lib/model/context';
import { buildFeedback } from '@/lib/model/feedback';
import { linkedIds } from '@/lib/store/request-context';
import { sectionsOf } from './final/design-meta';
import { groupSubtasks } from './split/split-meta';
import { FeatureSplitView } from './split/SubtaskCards';

const TITLE = '子功能拆分：从设计 → 可执行任务';
const CHIP = '子功能拆分 · 可执行任务';

/** The design snapshot the split prompt reads, rebuilt from the final node's items. */
function designOf(data: NodeData) {
  const live = <T extends { decision: string }>(xs: T[]) => xs.filter((x) => x.decision !== 'rejected');
  const sections = live(data.of('design_section', 'final'));
  const [overview] = sectionsOf(sections, 'overview');
  const modules = data.context('final', 'module');
  if (!overview || modules.length === 0) return null;
  return {
    snapshot: {
      title: overview.body.title,
      one_liner: overview.body.one_liner,
      modules: modules.map((m) => ({ id: m.id, name: m.body.name, feature_ids: linkedIds(data.links, m.id, 'implements') })),
      user_flows: sectionsOf(sections, 'flow').map((f) => ({ name: f.body.name, goal: f.body.goal })),
      data_model: sectionsOf(sections, 'data_entity').map((e) => ({ name: e.body.name })),
    },
    inputs: inputsOf([overview], modules),
  };
}

function useSplit(data: NodeData) {
  const { slug } = useProject();
  const ai = useAiAction();
  const run = () => {
    const design = designOf(data);
    if (!design) return;
    void ai.run('split', {
      route: '/api/ai/split-subfeatures',
      body: { projectSlug: slug, design: design.snapshot, feedback: buildFeedback(data.all, [{ node: 'split', type: 'subtask' }]) },
      node: 'split', inputs: design.inputs, adapt: adaptSubfeatureBreakdown,
    });
  };
  return { run, running: ai.running !== null, error: ai.error };
}

function copilotCards(data: NodeData, hasDesign: boolean, slug: string): CopilotCard[] {
  if (!hasDesign) {
    return [{ tag: 'check', title: '需要先完成 08 设计案', body: <>请回到 <Link href={`/project/${slug}/final`} style={{ color: 'var(--accent)' }}>08 设计案</Link> 节点生成完整设计后再来。</> }];
  }
  const subtasks = data.of('subtask');
  if (subtasks.length === 0) {
    return [{ tag: 'feed', title: '点"拆分子任务"', body: '我会把每个 feature → 2-6 条可执行子任务（前端/后端/数据/AI 标签 + 工作量估计 + 验收标准）。' }];
  }
  const critical = subtasks.filter((s) => s.body.critical);
  return [
    { tag: 'feed', title: `共 ${subtasks.length} 条子任务`, body: summaryItem(data.items, 'split')?.body.text ?? '' },
    ...(critical.length > 0 ? [{ tag: 'check' as const, title: `关键路径（${critical.length}）`, body: critical.map((s) => s.body.title).join(' → ') }] : []),
  ];
}

export function SplitNode() {
  const { slug } = useProject();
  const data = useNodeData('split');
  const design = useMemo(() => designOf(data), [data]);
  const { run, running, error } = useSplit(data);
  const subtasks = data.of('subtask');
  const copilot = (
    <Copilot projectSlug={slug} nodeKind="split" cards={copilotCards(data, !!design, slug)} pending={running}
      extraSlot={subtasks.length > 0 ? <FollowUpsPanel node="split" items={data.items} /> : null} />
  );
  if (!data.loading && !design) {
    return (
      <NodeFrame copilot={copilot}>
        <MissingUpstream kind="split" chip={CHIP} title={TITLE} heading="尚无设计案">
          <p>请先完成 <NodeLink kind="final">08 设计案</NodeLink> 节点。</p>
        </MissingUpstream>
      </NodeFrame>
    );
  }
  return (
    <NodeFrame wide copilot={copilot}>
      <NodeHat kind="split" chip={CHIP} />
      <h1 className="node-title">{TITLE}</h1>
      <p className="node-intro">把 08 设计案里的每个 feature → 立刻能开 ticket 的子任务。每条带 layer 标签、工作量估计、验收标准。</p>
      <StoreStatus data={data} />
      {subtasks.length === 0 && design ? (
        <div className="para-section" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <div className="dim" style={{ fontSize: 13 }}>
            输入：{design.snapshot.modules.length} 模块 · {design.snapshot.modules.reduce((n, m) => n + m.feature_ids.length, 0)} 功能
          </div>
          <button type="button" className="btn btn-accent" onClick={run} disabled={running}>
            {running ? <><span className="ai-spinner" /> &nbsp;拆分中… 通常 60-120 秒</> : '拆分子任务 →'}
          </button>
        </div>
      ) : subtasks.length > 0 ? (
        <BreakdownView data={data} onRerun={run} rerunning={running} />
      ) : null}
      <ErrorCard message={error} />
    </NodeFrame>
  );
}

function BreakdownView({ data, onRerun, rerunning }: { data: NodeData; onRerun: () => void; rerunning: boolean }) {
  const actions = useItemActions();
  const subtasks = data.of('subtask');
  const groups = groupSubtasks(data, subtasks);
  const summary = summaryItem(data.items, 'split');
  const titles = new Map(subtasks.map((s) => [s.id, s.body.title]));
  return (
    <>
      <JudgeBar node="split" judged={['subtask']} />
      <div className="design-header">
        <div style={{ flex: 1 }}>
          <div className="design-oneliner">
            {summary ? (
              <EditableText value={summary.body.text} placeholder="一句话总结…" onChange={(v) => void actions.editBody(summary, { ...summary.body, text: v })} />
            ) : null}
          </div>
          <div className="dim" style={{ marginTop: 4, fontSize: 12 }}>
            {groups.length} 个 feature · {subtasks.length} 条子任务 · 关键路径 {subtasks.filter((s) => s.body.critical).length} 条
          </div>
        </div>
        <button type="button" className="btn btn-ghost" onClick={onRerun} disabled={rerunning}>{rerunning ? '重新生成中…' : '重新拆分'}</button>
      </div>
      {groups.map((g) => <FeatureSplitView key={g.key} group={g} links={data.links} titles={titles} />)}
    </>
  );
}
