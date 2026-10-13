import type { Alternative, AlternativesAnalysis } from '../../ai/schemas/analyze-alternatives';
import type { ItemDraft } from '../repository';
import type { AiStance, Evidence } from '../types';
import { critiqueDrafts, modelStance, neutral, recommend, scopes, type AdaptedOutput } from './common';

function altStance(a: Alternative): AiStance {
  if (a.category === 'non_consumption') return recommend('非消费替代 · 真正的对手');
  if (a.threat_level === 'high') return recommend('高威胁 · 对目标用户 / Job 挑战大');
  if (a.threat_level === 'medium') return recommend('中威胁 · 值得纳入对比');
  return neutral('低威胁 · 可作参考');
}

/**
 * The URLs the AI cites for an alternative become evidence sources (unchecked). The prompt only
 * allows URLs it found with web search, so the basis is `web`; ALT_SCAN states no confidence and
 * no title per URL, so neither is invented (a source check compares the page title with the
 * alternative's name instead).
 */
export function altEvidence(urls: readonly string[]): Evidence | undefined {
  if (urls.length === 0) return undefined;
  return { basis: 'web', sources: urls.map((url) => ({ title: '', url, verified: false })) };
}

/**
 * ALT_SCAN → alternatives (their source URLs moved from the body into evidence.sources),
 * strategic profiles and feature breakdowns linked to their alternative, the differentiation
 * hypothesis singleton (with the key threats, the model's own verdict as aiStance) and critiques.
 */
export function adaptAlternatives(out: AlternativesAnalysis): AdaptedOutput {
  const alternatives = out.alternatives.map((a): ItemDraft => {
    const evidence = altEvidence(a.sources);
    return { ref: a.id, type: 'alternative', body: { ...a, sources: [] }, aiStance: altStance(a), ...(evidence ? { evidence } : {}) };
  });
  const profiles = out.strategic_profiles.map((p): ItemDraft => ({ type: 'alt_profile', body: p }));
  const breakdowns = out.feature_breakdowns.map((b): ItemDraft => ({ type: 'alt_breakdown', body: b }));
  const hypothesis: ItemDraft = {
    type: 'diff_hypothesis',
    body: { statement: out.differentiation_hypothesis, key_threats: out.key_threats },
    aiStance: modelStance(out.differentiation_stance),
  };
  return {
    drafts: [...alternatives, ...profiles, ...breakdowns, hypothesis, ...critiqueDrafts(out.critiques)],
    replace: scopes('alt', 'alternative', 'alt_profile', 'alt_breakdown', 'critique'),
  };
}
