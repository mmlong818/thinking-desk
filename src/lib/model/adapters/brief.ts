import type { BriefExtraction, ClarificationAnswer } from '../../ai/schemas/extract-brief';
import type { ItemDraft } from '../repository';
import { caution, neutral, recommend, scopes, UNEXPLAINED_REASON, type AdaptedOutput } from './common';

/** The brief completeness the methodology asks for before moving on. */
export const BRIEF_COMPLETENESS_THRESHOLD = 70;

export const RED_LINE_STATED_REASON = 'Brief 原文写明';

export interface ExtractBriefContext {
  rawText: string;
  answers: ClarificationAnswer[];
}

function completenessStance(completeness: number) {
  if (completeness >= BRIEF_COMPLETENESS_THRESHOLD) {
    return recommend(`完整度 ${completeness}% · 已达 ${BRIEF_COMPLETENESS_THRESHOLD}% 阈值`);
  }
  const gap = BRIEF_COMPLETENESS_THRESHOLD - completeness;
  return caution(`完整度 ${completeness}% · 还差 ${gap} 个百分点，右侧追问可补齐`);
}

/**
 * BRIEF_EXTRACT → the brief singleton (rewritten in place on re-runs), one `red_line` item per
 * stated or inferred red line, and one `assumption` item per assumption highlight, linked brief —assumes→ assumption.
 */
export function adaptExtractBrief(out: BriefExtraction, ctx: ExtractBriefContext): AdaptedOutput {
  const assumptions: ItemDraft[] = out.highlights
    .filter((h) => h.kind === 'assumption')
    .map((h, i) => ({
      ref: `asm-${i + 1}`,
      type: 'assumption',
      body: { statement: h.text, quote: h.text, ...(h.reason ? { rationale: h.reason } : {}) },
    }));
  const { red_lines: redLines, ...fields } = out.fields;
  const brief: ItemDraft = {
    type: 'brief',
    body: {
      raw_text: ctx.rawText,
      fields,
      highlights: out.highlights.filter((h) => h.kind !== 'assumption'),
      follow_ups: out.follow_ups,
      completeness: out.completeness,
      answers: ctx.answers,
      follow_up_answers: {},
    },
    aiStance: completenessStance(out.completeness),
    links: assumptions.map((a) => ({ ref: a.ref ?? '', rel: 'assumes', to: ['assumption'] })),
  };
  return { drafts: [brief, ...redLineDrafts(redLines, out.inferred_red_lines), ...assumptions], replace: scopes('brief', 'red_line', 'assumption') };
}

/**
 * Red lines the brief states are recommended; the ones the AI inferred stay neutral with its own
 * reason, so accepting them is the person's call. Both kinds are the same `red_line` item.
 */
function redLineDrafts(stated: readonly string[], inferred: BriefExtraction['inferred_red_lines']): ItemDraft[] {
  const statedTexts = stated.map((t) => t.trim()).filter(Boolean);
  const statedDrafts = statedTexts.map((text): ItemDraft => ({ type: 'red_line', body: { text }, aiStance: recommend(RED_LINE_STATED_REASON) }));
  const inferredDrafts = inferred
    .map((r) => ({ text: r.text.trim(), reason: r.reason.trim() }))
    .filter((r) => r.text && !statedTexts.includes(r.text))
    .map((r): ItemDraft => ({ type: 'red_line', body: { text: r.text }, aiStance: neutral(r.reason || UNEXPLAINED_REASON) }));
  return [...statedDrafts, ...inferredDrafts];
}
