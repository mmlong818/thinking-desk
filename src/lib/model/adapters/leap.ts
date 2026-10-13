import type {
  CreativeLeapAnalysis,
  LeapRecommendation,
  MoreItemsResult,
} from '../../ai/schemas/creative-leap';
import type { ItemDraft } from '../repository';
import type { ItemType } from '../types';
import { critiqueDrafts, recommend, scopes, summaryDraft, type AdaptedOutput } from './common';

const PICK_TYPE: Record<LeapRecommendation['top_picks'][number]['source_method'], ItemType> = {
  first_principles: 'first_principle',
  analogy: 'analogy',
  constraint_flip: 'constraint_flip',
};

function leapDrafts(out: MoreItemsResult): ItemDraft[] {
  return [
    ...(out.first_principles ?? []).map((x): ItemDraft => ({ ref: x.id, type: 'first_principle', body: x })),
    ...(out.analogies ?? []).map((x): ItemDraft => ({ ref: x.id, type: 'analogy', body: x })),
    ...(out.constraint_flips ?? []).map((x): ItemDraft => ({ ref: x.id, type: 'constraint_flip', body: x })),
  ];
}

/**
 * `top_picks` are not Links: each pick becomes aiStance recommend (the AI's "why") plus
 * `required_changes` on the referenced draft. Picks naming an unknown id are dropped.
 */
function applyTopPicks(drafts: ItemDraft[], picks: LeapRecommendation['top_picks']): ItemDraft[] {
  return drafts.map((d) => {
    const pick = picks.find((p) => p.source_id === d.ref && PICK_TYPE[p.source_method] === d.type);
    if (!pick) return d;
    return {
      ...d,
      body: { ...(d.body as object), required_changes: pick.required_changes },
      aiStance: recommend(pick.why),
    };
  });
}

/** LEAP_FIRST_PRINCIPLES (initial) → the three leap kinds, timing summary and critiques. */
export function adaptLeapAnalysis(out: CreativeLeapAnalysis): AdaptedOutput {
  const rec = out.recommendation;
  return {
    drafts: [
      ...applyTopPicks(leapDrafts(out), rec.top_picks),
      ...summaryDraft('leap_timing', rec.timing_reason, { verdict: rec.timing_verdict }),
      ...critiqueDrafts(out.critiques),
    ],
    replace: scopes('leap', 'first_principle', 'analogy', 'constraint_flip', 'summary', 'critique'),
  };
}

/** LEAP_* "more items": additive, nothing is retired. */
export function adaptMoreLeapItems(out: MoreItemsResult): AdaptedOutput {
  return { drafts: leapDrafts(out), replace: [] };
}
