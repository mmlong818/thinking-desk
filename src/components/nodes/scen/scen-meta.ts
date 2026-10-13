import type { NodeData } from '@/components/project/useNodeData';
import type { ItemOfType } from '@/lib/model/context';
import type { ItemType } from '@/lib/model/types';

export type ScenStage = 'idle' | 'exhausting' | 'dimensions' | 'combining' | 'scenarios' | 'deepening' | 'done';
export type ElementItem = ItemOfType<'scenario_element'>;
export type ScenarioItem = ItemOfType<'scenario'>;

/** At most this many scenarios go into the deep analysis (they are the accepted ones). */
export const MAX_DEEP = 3;

export const DEEP_TYPES: readonly ItemType[] = ['matrix_cell', 'extreme', 'hostile', 'pain_point', 'delight_point', 'insight'];

export const CATEGORY_LABEL: Record<'core' | 'safety_net' | 'fringe', string> = {
  core: '核心',
  safety_net: '安全网',
  fringe: '边缘',
};

export const RUNNING_STAGE: Record<string, ScenStage> = {
  exhaust: 'exhausting',
  combine: 'combining',
  deep: 'deepening',
};

/** The furthest step the node's items reach. */
export function deriveScenStage(data: NodeData): ScenStage {
  if (data.items.some((i) => DEEP_TYPES.includes(i.type))) return 'done';
  if (data.of('scenario').length > 0) return 'scenarios';
  if (data.of('scenario_element').length > 0) return 'dimensions';
  return 'idle';
}

export function stageChip(stage: ScenStage): string {
  switch (stage) {
    case 'idle':       return '情景分析 · 预计 30 分钟';
    case 'exhausting': return '穷举 7 维要素…';
    case 'dimensions': return '勾选要素 · 请快速扫';
    case 'combining':  return '组合情景中…';
    case 'scenarios':  return '选 3 个情景深入';
    case 'deepening':  return '深度分析中…';
    case 'done':       return '已分析 · 5 份产出';
  }
}

export const accepted = <T extends { decision: string }>(items: readonly T[]) => items.filter((i) => i.decision === 'accepted');
