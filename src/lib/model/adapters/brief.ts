import type { BriefExtraction, ClarificationAnswer } from '../../ai/schemas/extract-brief';
import type { ItemDraft } from '../repository';
import { caution, recommend, scopes, type AdaptedOutput } from './common';

/** The brief completeness the methodology asks for before moving on. */
export const BRIEF_COMPLETENESS_THRESHOLD = 70;

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
 * red line, and one `assumption` item per assumption highlight, linked brief —assumes→ assumption.
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
  const redLineDrafts: ItemDraft[] = redLines
    .filter((text) => text.trim())
    .map((text) => ({ type: 'red_line', body: { text }, aiStance: recommend('从需求中识别的道德红线 · 后续节点的伦理审查会引用') }));
  return { drafts: [brief, ...redLineDrafts, ...assumptions], replace: scopes('brief', 'red_line', 'assumption') };
}
