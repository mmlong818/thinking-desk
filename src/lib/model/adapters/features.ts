import type { NodeKind } from '../../../data/nodes';
import type { Feature, FeatureList, NotDoing, Pillar } from '../../ai/schemas/draft-features';
import type { DraftLink, ItemDraft } from '../repository';
import type { AiStance } from '../types';
import { caution, critiqueDrafts, recommend, scopes, summaryDraft, type AdaptedOutput } from './common';

export const FEATURE_REASON = {
  priority: 'AI 建议优先',
  redLine: '触发道德红线 · 必须审查',
} as const;

/** `suggested_priority` → recommend; `red_line_risk` → caution, which wins. */
export function featureStance(f: Feature): AiStance | undefined {
  if (f.red_line_risk) return caution(f.ethics_concern?.trim() || FEATURE_REASON.redLine);
  if (f.suggested_priority) return recommend(FEATURE_REASON.priority);
  return undefined;
}

/**
 * Features name their pillar by the pillar's temp id or by its name; temp ids are not stable
 * once pillars get permanent ids, so the body keeps the pillar *name*.
 */
function pillarName(feature: Feature, pillars: readonly Pillar[]): string {
  return pillars.find((p) => p.id === feature.pillar)?.name ?? feature.pillar;
}

export function featureDrafts(
  features: readonly Feature[],
  pillars: readonly Pillar[],
  node: NodeKind,
  lineage: (f: Feature) => DraftLink[] = () => [],
): ItemDraft[] {
  return features.map((f): ItemDraft => {
    const aiStance = featureStance(f);
    const links = lineage(f);
    return {
      ref: f.id, type: 'feature', node,
      body: { ...f, pillar: pillarName(f, pillars) },
      ...(aiStance ? { aiStance } : {}),
      ...(links.length > 0 ? { links } : {}),
    };
  });
}

export function pillarDrafts(pillars: readonly Pillar[], node: NodeKind): ItemDraft[] {
  return pillars.map((p) => ({ ref: p.id, type: 'pillar', node, body: p }));
}

export function notDoingDrafts(items: readonly NotDoing[], node: NodeKind): ItemDraft[] {
  return items.map((n) => ({ type: 'not_doing', node, body: n }));
}

/** FEAT_DRAFT → pillars, features, the "not doing" list, the differentiation echo and critiques on `feat`. */
export function adaptFeatureList(out: FeatureList): AdaptedOutput {
  return {
    drafts: [
      ...pillarDrafts(out.pillars, 'feat'),
      ...featureDrafts(out.features, out.pillars, 'feat'),
      ...notDoingDrafts(out.not_doing, 'feat'),
      ...summaryDraft('differentiation_echo', out.differentiation_echo),
      ...critiqueDrafts(out.critiques),
    ],
    replace: scopes('feat', 'pillar', 'feature', 'not_doing', 'summary', 'critique'),
  };
}
