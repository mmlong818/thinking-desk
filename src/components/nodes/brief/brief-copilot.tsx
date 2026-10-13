import type { CopilotCard } from '@/components/shell/Copilot';
import { NodeFollowUpsRunner } from '@/components/shared/NodeFollowUpsRunner';
import type { BriefExtraction } from '@/lib/ai/schemas/extract-brief';
import type { ItemOfType } from '@/lib/model/context';
import type { Stage } from './brief-meta';

const STATIC_CARDS: Partial<Record<Stage['kind'], CopilotCard[]>> = {
  paste: [{
    tag: 'feed',
    title: '先把原始文字粘进来',
    body: (
      <>
        我会先<em>判断是否需要澄清</em>：如果需求已经很具体就直接抽取；
        如果还有关键信息没说清楚，我会先生成 7–9 个选择题让你勾一下，
        <em>再基于你的选择做结构化抽取</em>，这样精度会高得多。
      </>
    ),
  }],
  clarifying: [{ tag: 'feed', title: '正在判断是否需要澄清…', body: '我在读你的原始文字，判断清晰度。通常 10–30 秒。' }],
  extracting: [{ tag: 'feed', title: '正在做结构化抽取…', body: '把你的原文 + 问卷选择交给模型，标注事实/假设/缺失并填充 7 个字段。' }],
};

function modeChooseCards(stage: Extract<Stage, { kind: 'mode_choose' }>): CopilotCard[] {
  const mode = stage.ask.suggested_mode;
  return [{
    tag: 'ask',
    title: `我建议用「${mode === 'interview' ? '对话式追问' : '静态问卷'}」`,
    body: (
      <>
        {stage.ask.mode_reason || stage.ask.reasoning}
        <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>不同意？下面两个按钮都可以点，<em>你是司机</em>。</div>
      </>
    ),
  }];
}

function askCards(stage: Extract<Stage, { kind: 'ask' }>): CopilotCard[] {
  return [
    {
      tag: 'ask',
      title: '需要先问你几个关键问题',
      body: (
        <>
          {stage.reasoning}
          <div className="dim" style={{ marginTop: 6 }}>原则：<em>宁可不问也不问废话</em>，每道题的答案都会显著影响最终 Brief。</div>
        </>
      ),
    },
    { tag: 'check', title: '不想答可以跳过', body: '直接点"跳过问卷"就好，我会仅凭原文做最佳努力抽取，但通常完整度会低 15-25 个百分点。' },
  ];
}

function interviewCards(stage: Extract<Stage, { kind: 'interview' }>): CopilotCard[] {
  const n = stage.history.length;
  return [
    {
      tag: 'ask',
      title: n === 0 ? '开始对话式追问' : `已追问 ${n} 轮`,
      body: (
        <>
          {stage.reasoning}
          <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
            按方法论 §5.3，<em>还原你上一次真实做这件事的过程</em>——时间、地点、工具、情绪、替代方案都可能带出关键信息。
          </div>
        </>
      ),
    },
    { tag: 'check', title: '答够了随时结束', body: '下面有"结束追问"按钮，任何时候都可以提前收尾。最多 7 轮我会自动收尾。' },
  ];
}

function doneCards(
  brief: ItemOfType<'brief'>,
  highlights: BriefExtraction['highlights'],
  onAnswer: (field: string, answer: string) => void,
): CopilotCard[] {
  const count = (k: string) => highlights.filter((h) => h.kind === k).length;
  const answers = brief.body.answers.length;
  const feed: CopilotCard = {
    tag: 'feed',
    title: '抽取完成',
    body: (
      <>
        识别出 <b>{count('fact')} 个事实</b>、<b>{count('assumption')} 个假设</b>、<b>{count('missing')} 处缺失</b>。
        {answers > 0 ? <> 已基于你的 <b>{answers}</b> 个问卷选择。</> : null}
      </>
    ),
  };
  const followUps = brief.body.follow_ups;
  if (followUps.length === 0) return [feed];
  // 所有 follow_ups 包进一张交互卡：runner 内部处理"逐题展示"和多选 + 自由输入
  const runner = (
    <NodeFollowUpsRunner
      items={followUps.map((q) => ({ field: q.field, question: q.question, why: q.why, options: q.options ?? [] }))}
      answers={brief.body.follow_up_answers}
      onAnswer={onAnswer}
    />
  );
  return [feed, { tag: 'ask', title: '逐题补齐缺失', bare: true, body: runner }];
}

export function briefCopilotCards(
  stage: Stage,
  brief: ItemOfType<'brief'> | undefined,
  highlights: BriefExtraction['highlights'],
  onAnswer: (field: string, answer: string) => void,
): CopilotCard[] {
  switch (stage.kind) {
    case 'mode_choose': return modeChooseCards(stage);
    case 'ask': return askCards(stage);
    case 'interview': return interviewCards(stage);
    case 'done': return brief ? doneCards(brief, highlights, onAnswer) : [];
    default: return STATIC_CARDS[stage.kind] ?? [];
  }
}
