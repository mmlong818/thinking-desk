import type { Stakeholder } from '@/lib/ai/schemas/analyze-stakeholders';
import type { ItemOfType } from '@/lib/model/context';

export type Quadrant = 'manage' | 'satisfy' | 'inform' | 'monitor';
export type StakeItem = ItemOfType<'stakeholder'>;

export const QUADRANT_META: Record<Quadrant, { title: string; subtitle: string; hint: string }> = {
  manage: { title: '重点管理', subtitle: 'Manage Closely', hint: '高权力 · 高关心 → 深度共创' },
  satisfy: { title: '保持满意', subtitle: 'Keep Satisfied', hint: '高权力 · 低关心 → 重点汇报' },
  inform: { title: '保持告知', subtitle: 'Keep Informed', hint: '低权力 · 高关心 → 信息同步' },
  monitor: { title: '最低力度', subtitle: 'Monitor', hint: '低权力 · 低关心 → 定期扫描' },
};

export const CATEGORY_LABEL: Record<Stakeholder['category'], string> = {
  sponsor: '发起人',
  maker: '设计/产品',
  business: '业务方',
  user: '用户',
  compliance: '合规',
  partner: '合作方',
  competitor: '竞品',
  other: '其他',
};

/** Baseline stakeholders stay mandatory, as before: they can be accepted, not rejected. */
export const REQUIRED_REJECT_BLOCKED = '基线角色 · 必选不可否决';

export function quadrantOf(s: Pick<Stakeholder, 'power' | 'interest'>): Quadrant {
  if (s.power === 'high' && s.interest === 'high') return 'manage';
  if (s.power === 'high' && s.interest === 'low') return 'satisfy';
  if (s.power === 'low' && s.interest === 'high') return 'inform';
  return 'monitor';
}

export function groupByQuadrant(items: readonly StakeItem[]): Record<Quadrant, StakeItem[]> {
  const by: Record<Quadrant, StakeItem[]> = { manage: [], satisfy: [], inform: [], monitor: [] };
  for (const s of items) by[quadrantOf(s.body)].push(s);
  return by;
}
