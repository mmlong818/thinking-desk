import type { Alternative, StrategicProfile } from '@/lib/ai/schemas/analyze-alternatives';
import type { ItemOfType } from '@/lib/model/context';

export type AltItem = ItemOfType<'alternative'>;

export const CATEGORY_META: Record<Alternative['category'], { label: string; sub: string; hint: string; cls: string }> = {
  direct: { label: '直接替代', sub: 'Direct', hint: '同品类 · 同目标用户 · 表面对手', cls: 'direct' },
  indirect: { label: '间接替代', sub: 'Indirect', hint: '不同品类 · 相同 Job', cls: 'indirect' },
  non_consumption: { label: '非消费替代', sub: 'Non-consumption', hint: '★ 真正的对手 · 用户干脆不解决这个问题', cls: 'nonc' },
};

export const THREAT_META: Record<Alternative['threat_level'], { label: string; cls: string }> = {
  high: { label: '高威胁', cls: 'high' },
  medium: { label: '中威胁', cls: 'medium' },
  low: { label: '低威胁', cls: 'low' },
};

export const MOAT_META: Record<StrategicProfile['moat_strength'], { label: string; cls: string }> = {
  strong: { label: '难逾越', cls: 'strong' },
  medium: { label: '可逾越', cls: 'medium' },
  weak: { label: '弱', cls: 'weak' },
};
