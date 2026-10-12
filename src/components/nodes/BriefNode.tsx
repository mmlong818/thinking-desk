'use client';

import { useMemo } from 'react';
import { Copilot } from '@/components/shell/Copilot';
import { BriefClarifier } from '@/components/nodes/BriefClarifier';
import { BriefInterview } from '@/components/nodes/BriefInterview';
import { useProject } from '@/components/project/ProjectStore';
import { useNodeData } from '@/components/project/useNodeData';
import { LoadingCard, NodeFrame, NodeHat, ParaHead, StoreStatus } from '@/components/shared/NodeKit';
import { briefRequestContext } from '@/lib/model/context';
import { briefCopilotCards } from './brief/brief-copilot';
import { stageChip, type Stage } from './brief/brief-meta';
import { BriefDone } from './brief/BriefDone';
import { ModeChooser } from './brief/ModeChooser';
import { PasteSection } from './brief/PasteSection';
import { useBriefEditing } from './brief/useBriefEditing';
import { useBriefFlow } from './brief/useBriefFlow';
import { useImportNotice, useRawTextDraft } from './brief/useRawTextDraft';

type Flow = ReturnType<typeof useBriefFlow>;

export function BriefNode() {
  const { slug, store } = useProject();
  const data = useNodeData('brief');
  const brief = data.of('brief')[0];
  const redLines = data.of('red_line');
  const ctx = useMemo(() => briefRequestContext(data.all), [data.all]);
  const [rawText, setRawText] = useRawTextDraft(store.projectId, brief, data.loading);
  const flow = useBriefFlow(brief, rawText);
  const editing = useBriefEditing(brief, redLines);
  const { stage } = flow;
  const highlights = ctx?.brief.highlights ?? [];
  const silent = stage.kind === 'paste' && rawText.trim() === '';
  const pending = stage.kind === 'clarifying' || stage.kind === 'extracting' || (stage.kind === 'interview' && stage.probing);
  const copilot = (
    <Copilot
      projectSlug={slug} nodeKind="brief" silent={silent} pending={pending}
      cards={silent ? [] : briefCopilotCards(stage, brief, highlights, editing.applyFollowUp)}
    />
  );
  return (
    <NodeFrame copilot={copilot}>
      <NodeHat kind="brief" chip={stageChip(stage)} />
      <h1 className="node-title">Brief：先把问题说清楚</h1>
      <p className="node-intro">
        先把手上的需求<em>用一两段话描述</em>出来——可以直接复制老板的原话。
        我会先判断是否需要澄清，<em>缺信息就先问你几个选择题</em>，然后再做结构化抽取。
      </p>
      <ImportNotice projectId={store.projectId} />
      <StoreStatus data={data} />
      {data.loading ? null : (
        <PasteSection stage={stage} rawText={rawText} onChange={setRawText} onStart={flow.start} highlights={highlights} error={flow.error} />
      )}
      <FlowSections stage={stage} flow={flow} />
      {stage.kind === 'done' && brief ? (
        <BriefDone brief={brief} redLines={redLines} assumptions={data.of('assumption')} editing={editing} onReset={flow.reset} />
      ) : null}
    </NodeFrame>
  );
}

/** § 2: the mode chooser, the questionnaire or the interview, then the extraction spinner. */
function FlowSections({ stage, flow }: { stage: Stage; flow: Flow }) {
  if (stage.kind === 'mode_choose') {
    return (
      <div className="para-section">
        <ParaHead title="选择澄清方式" hint={`AI 建议：${stage.ask.suggested_mode === 'interview' ? '对话式追问' : '静态问卷'}`} />
        <ModeChooser ask={stage.ask} onPick={flow.pickMode} onSkip={flow.skipClarifier} />
      </div>
    );
  }
  if (stage.kind === 'ask') {
    return (
      <div className="para-section">
        <ParaHead title="澄清问卷" hint="AI 现场生成 · 按需求定制" />
        <BriefClarifier
          reasoning={stage.reasoning} needType={stage.needType} questions={stage.questions}
          onSubmit={flow.submitAnswers} onSkip={flow.skipClarifier} pending={false}
        />
      </div>
    );
  }
  if (stage.kind === 'interview') {
    return (
      <div className="para-section">
        <ParaHead title="对话式追问" hint={`§5.3 访谈法 · ${stage.history.length} 轮已答`} />
        <BriefInterview
          history={stage.history} current={stage.current} pending={stage.probing}
          onAnswer={flow.answer} onSkipCurrent={flow.skipCurrent} onFinish={() => void flow.finishInterview()}
        />
      </div>
    );
  }
  return stage.kind === 'extracting' ? <LoadingCard>正在做结构化抽取，通常 20–40 秒……</LoadingCard> : null;
}

function ImportNotice({ projectId }: { projectId: string }) {
  const [notice, dismiss] = useImportNotice(projectId);
  if (!notice) return null;
  return (
    <div role="status" className="import-notice">
      <span className="import-notice-tag">导入</span>
      <span style={{ flex: 1 }}>{notice}</span>
      <button type="button" className="import-notice-close" onClick={dismiss} aria-label="关闭">×</button>
    </div>
  );
}
