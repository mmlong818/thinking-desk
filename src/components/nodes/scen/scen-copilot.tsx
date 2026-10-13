import type { CopilotCard } from '@/components/shell/Copilot';
import type { NodeData } from '@/components/project/useNodeData';
import { critiqueCards } from '@/components/shared/copilot-cards';
import { accepted, MAX_DEEP, type ScenStage } from './scen-meta';

const STATIC: Partial<Record<ScenStage, CopilotCard[]>> = {
  idle: [{
    tag: 'feed',
    title: '§八 情景分析的流水线',
    body: (
      <>
        三步走：<em>7 维穷举候选</em>（AI）→ <em>你勾选要素</em> → <em>AI 组合出情景</em> →
        <em>你选 3 个深入</em> → AI 一次产出矩阵/极值/敌意/痛快点/设计启发。
      </>
    ),
  }],
  exhausting: [{ tag: 'feed', title: '穷举 7 维要素…', body: '每维 8-12 个候选，通常 30-60 秒' }],
  combining: [{ tag: 'feed', title: '组合情景中…', body: '基于你选的要素交叉组合 5-8 个具体情景' }],
  deepening: [{ tag: 'feed', title: '深度分析中…', body: '同时计算矩阵 + 极值 + 敌意 + 痛快点 + 设计启发，通常 60-120 秒' }],
};

function dimensionsCards(data: NodeData): CopilotCard[] {
  const count = accepted(data.of('scenario_element')).length;
  return [{
    tag: 'ask',
    title: `已选 ${count} 个要素`,
    body: (
      <>
        AI 把"高相关"候选标成了推荐（虚线框），点上方"采纳全部推荐"可一键勾上。
        <em>快速扫一遍</em>，加勾漏掉的、取消不相关的，然后点下一步让我组合情景。
        <div className="dim" style={{ marginTop: 6, fontSize: 12 }}>方法论要求"先发散再收敛"——多选几个没关系，少选容易漏。</div>
      </>
    ),
  }];
}

function scenariosCards(data: NodeData): CopilotCard[] {
  const picked = accepted(data.of('scenario')).length;
  return [{
    tag: 'ask',
    title: `选 3 个最值得深入的情景（已选 ${picked} / ${MAX_DEEP}）`,
    body: (
      <>
        方法论建议选<em>覆盖差异最大</em>的 3 个——例如"独自" + "家长在旁" + "考前"三类互斥状态。
        深入会产出：矩阵、极值、敌意、痛点根因、设计启发。
      </>
    ),
  }];
}

function doneCards(data: NodeData): CopilotCard[] {
  return [
    {
      tag: 'feed',
      title: `深度分析完成 · ${data.of('insight').length} 条设计启发`,
      body: (
        <>
          覆盖 <b>{data.of('extreme').length} 个极值情景</b> · <b>{data.of('hostile').length} 个敌意情景</b> · <b>{data.of('pain_point').length} 个痛点（连续追问 3 层）</b>。
        </>
      ),
    },
    ...critiqueCards(data.items),
  ];
}

export function scenCopilotCards(data: NodeData, stage: ScenStage, hasBrief: boolean): CopilotCard[] {
  if (!hasBrief) return [{ tag: 'check', title: '需要 Brief', body: '请先完成 Brief 节点' }];
  if (stage === 'dimensions') return dimensionsCards(data);
  if (stage === 'scenarios') return scenariosCards(data);
  if (stage === 'done') return doneCards(data);
  return STATIC[stage] ?? [];
}
