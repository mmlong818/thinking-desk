import type { ConstraintFlip, CreativeLeapAnalysis, LeapCategory } from '@/lib/ai/schemas/creative-leap';
import type { ItemOfType } from '@/lib/model/context';

export type LeapType = 'first_principle' | 'analogy' | 'constraint_flip';
export type LeapItem = ItemOfType<LeapType>;
export type Verdict = CreativeLeapAnalysis['recommendation']['timing_verdict'];

export const LEAP_TYPES: readonly LeapType[] = ['first_principle', 'analogy', 'constraint_flip'];

/** "More items" categories of the creative-leap route ↔ item types. */
export const CATEGORY_OF: Record<LeapType, LeapCategory> = {
  first_principle: 'first_principles',
  analogy: 'analogies',
  constraint_flip: 'constraint_flips',
};

export const TIMING_META: Record<Verdict, { label: string; cls: string; hint: string }> = {
  bold:      { label: '大胆跃迁',   cls: 'go',    hint: '进入红海 / 怀疑共识 / 方案注定平庸 —— 推翻多个常规假设' },
  selective: { label: '精选跃迁',   cls: 'maybe', hint: '大致走标准路径 · 但在 1-2 个关键点上做独立判断（大部分项目在这档）' },
  minimal:   { label: '最小跃迁',   cls: 'skip',  hint: '项目本质要稳 · 至少保留 1 条跃迁 —— 全盘照抄行业模板不叫设计' },
};

export const METHOD_LABEL: Record<LeapType, string> = {
  first_principle: '第一性原理',
  analogy: '类比迁移',
  constraint_flip: '约束反转',
};

export const PICK_LABEL: Record<LeapType, string> = { first_principle: '第一性', analogy: '类比', constraint_flip: '反转' };
export const PICK_CLASS: Record<LeapType, string> = {
  first_principle: 'first_principles', analogy: 'analogies', constraint_flip: 'constraint_flips',
};

export const FEAS_META: Record<'high' | 'medium' | 'low', { label: string; cls: string }> = {
  high:   { label: '高可行', cls: 'feas-high' },
  medium: { label: '中等',   cls: 'feas-medium' },
  low:    { label: '低可行', cls: 'feas-low' },
};

export const FLIP_LABEL: Record<ConstraintFlip['flip_type'], string> = {
  remove_constraint: '去掉约束',
  add_constraint: '加一个约束',
  reverse_goal: '反转目标',
};

/** The one-line title of a leap (picks list). */
export function leapTitle(item: LeapItem): string {
  if (item.type === 'first_principle') return item.body.opportunity;
  if (item.type === 'analogy') return item.body.transferred_mechanism;
  return item.body.flipped;
}
