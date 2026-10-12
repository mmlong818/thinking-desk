import type { Alternative, AlternativesAnalysis } from '../../ai/schemas/analyze-alternatives';
import type { ItemDraft } from '../repository';
import type { AiStance } from '../types';
import { critiqueDrafts, neutral, recommend, scopes, type AdaptedOutput } from './common';

export const DIFF_HYPOTHESIS_REASON = 'AI 的一句话差异化假设 · 采纳后传给下游节点';

function altStance(a: Alternative): AiStance {
  if (a.category === 'non_consumption') return recommend('非消费替代 · 真正的对手');
  if (a.threat_level === 'high') return recommend('高威胁 · 对目标用户 / Job 挑战大');
  if (a.threat_level === 'medium') return recommend('中威胁 · 值得纳入对比');
  return neutral('低威胁 · 可作参考');
}

/**
 * ALT_SCAN → alternatives (sources stay on the body until the task emits evidence), strategic
 * profiles and feature breakdowns linked to their alternative, the differentiation hypothesis
 * singleton (with the key threats) and critiques.
 */
export function adaptAlternatives(out: AlternativesAnalysis): AdaptedOutput {
  const alternatives = out.alternatives.map((a): ItemDraft => ({
    ref: a.id, type: 'alternative', body: a, aiStance: altStance(a),
  }));
  const profiles = out.strategic_profiles.map((p): ItemDraft => ({ type: 'alt_profile', body: p }));
  const breakdowns = out.feature_breakdowns.map((b): ItemDraft => ({ type: 'alt_breakdown', body: b }));
  const hypothesis: ItemDraft = {
    type: 'diff_hypothesis',
    body: { statement: out.differentiation_hypothesis, key_threats: out.key_threats },
    aiStance: recommend(DIFF_HYPOTHESIS_REASON),
  };
  return {
    drafts: [...alternatives, ...profiles, ...breakdowns, hypothesis, ...critiqueDrafts(out.critiques)],
    replace: scopes('alt', 'alternative', 'alt_profile', 'alt_breakdown', 'critique'),
  };
}
