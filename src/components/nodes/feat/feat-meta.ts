import type { KanoKind, NotDoing } from '@/lib/ai/schemas/draft-features';
import type { ItemOfType } from '@/lib/model/context';

export type FeatureItem = ItemOfType<'feature'>;
export type PillarItem = ItemOfType<'pillar'>;
export type KanoFilter = KanoKind | 'all';

export const KANO_FILTER_KEYS: KanoFilter[] = ['all', 'must', 'performance', 'delight', 'reverse'];

export const NOT_DOING_REASON: Record<NotDoing['reason'], { label: string; cls: string }> = {
  boundary:    { label: '超出边界',     cls: 'boundary' },
  ethics:      { label: '伦理问题',     cls: 'ethics' },
  indifferent: { label: 'Kano 无差别',  cls: 'indiff' },
  low_rice:    { label: 'RICE 太低',    cls: 'lowrice' },
  dependency:  { label: '依赖未满足',   cls: 'depend' },
};

/** A feature names its pillar by name (the adapter's choice) or, after edits, by pillar id. */
export function pillarOf(f: FeatureItem, pillars: PillarItem[]): PillarItem | undefined {
  return pillars.find((p) => p.body.name === f.body.pillar || p.id === f.body.pillar);
}

export const isRecommended = (f: FeatureItem) => f.aiStance?.verdict === 'recommend';
