import type { Stakeholder, StakeholdersAnalysis } from '../../ai/schemas/analyze-stakeholders';
import type { ItemDraft } from '../repository';
import type { AiStance } from '../types';
import { critiqueDrafts, recommend, scopes, summaryDraft, type AdaptedOutput } from './common';

// The old matrix pre-selected baseline (required) stakeholders and the manage-closely quadrant.
export const STAKE_REASON = {
  required: '基线角色 · 必选',
  manage: '高权力 · 高关心 → 深度共创',
} as const;

function stakeStance(s: Stakeholder): AiStance | undefined {
  if (s.required) return recommend(STAKE_REASON.required);
  if (s.power === 'high' && s.interest === 'high') return recommend(STAKE_REASON.manage);
  return undefined;
}

/** STAKE_MATRIX → stakeholders, the engagement plan singleton, priority summary and critiques. */
export function adaptStakeholders(out: StakeholdersAnalysis): AdaptedOutput {
  const stakeholders = out.stakeholders.map((s): ItemDraft => {
    const aiStance = stakeStance(s);
    return { ref: s.id, type: 'stakeholder', body: s, ...(aiStance ? { aiStance } : {}) };
  });
  return {
    drafts: [
      ...stakeholders,
      { type: 'engagement_plan', body: out.engagement_plan },
      ...summaryDraft('priority', out.priority_summary),
      ...critiqueDrafts(out.critiques),
    ],
    replace: scopes('stake', 'stakeholder', 'summary', 'critique'),
  };
}
