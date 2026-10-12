import { z } from 'zod';
import type { Item, ItemBody } from './item-types';
import { inScope } from './regenerate';
import type { ReplaceScope } from './repository';
import { ItemTypeSchema, type ItemType } from './types';

// Feedback a regenerating run hands the AI (docs/data-model.md § "Regeneration"): what the person
// kept or touched — don't duplicate it, refer to it by id — and what they rejected, with their
// reason, so the next output steers away from it.

const FeedbackEntry = z.object({
  id: z.string().min(1).max(100),
  type: ItemTypeSchema,
  summary: z.string().max(400),
});

export const RegenerationFeedbackSchema = z.object({
  keep: z.array(FeedbackEntry).max(60).default([]),
  avoid: z.array(FeedbackEntry.extend({ note: z.string().max(1000).optional() })).max(60).default([]),
});
export type RegenerationFeedback = z.output<typeof RegenerationFeedbackSchema>;

const MAX_ENTRIES = 40;
const SUMMARY_MAX = 120;

type Summarizers = { [T in ItemType]: (b: ItemBody<T>) => string };

const SUMMARY: Summarizers = {
  brief: (b) => b.fields.problem_statement ?? b.raw_text,
  assumption: (b) => b.statement,
  red_line: (b) => b.text,
  persona: (b) => `${b.name} · ${b.one_liner}`,
  job: (b) => `[${b.dimension}] ${b.title}`,
  stakeholder: (b) => `${b.name}（${b.role}）`,
  engagement_plan: (b) => b.manage,
  alternative: (b) => `${b.name} · ${b.category}`,
  alt_profile: (b) => b.promise,
  alt_breakdown: (b) => b.headline_features.join(' · '),
  diff_hypothesis: (b) => b.statement,
  scenario_element: (b) => `[${b.dim}] ${b.text}`,
  scenario: (b) => b.title,
  matrix_cell: (b) => `${b.category} · ${b.note}`,
  extreme: (b) => `${b.dim}：${b.pushed_to_limit}`,
  hostile: (b) => b.attack,
  pain_point: (b) => `${b.moment} → ${b.root_cause}`,
  delight_point: (b) => `${b.moment} → ${b.opportunity}`,
  insight: (b) => b.insight_text,
  pillar: (b) => b.name,
  feature: (b) => `${b.name} · ${b.description}`,
  not_doing: (b) => b.name,
  first_principle: (b) => `${b.industry_assumption} → ${b.opportunity}`,
  analogy: (b) => `${b.source_domain} → ${b.transferred_mechanism}`,
  constraint_flip: (b) => `${b.original} → ${b.flipped}`,
  revision: (b) => `${b.action} ${b.name_after ?? b.name_before ?? ''}`.trim(),
  design_section: (b) => designSectionSummary(b),
  module: (b) => `${b.name} · ${b.responsibility}`,
  subtask: (b) => b.title,
  summary: (b) => b.text,
  critique: (b) => b.title,
};

function designSectionSummary(b: ItemBody<'design_section'>): string {
  switch (b.kind) {
    case 'overview': return b.title;
    case 'principles': return b.items.join(' · ');
    case 'flow': case 'data_entity': case 'metric': return b.name;
    case 'risk': return b.risk;
    case 'milestone': return b.phase;
    case 'open_question': return b.text;
    default: return b.title;
  }
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length > SUMMARY_MAX ? `${t.slice(0, SUMMARY_MAX - 1)}…` : t;
}

/** One-line, per-type summary of an item (prompt feedback, exports, compact UI). */
export function itemSummary(item: Item): string {
  const fn = SUMMARY[item.type] as (b: unknown) => string;
  return clip(fn(item.body));
}

/** Kept = accepted or human-touched (not rejected); avoided = rejected, with the decision note. */
export function buildFeedback(items: readonly Item[], scopes: readonly ReplaceScope[]): RegenerationFeedback {
  const live = items.filter((i) => !i.deletedAt && inScope(i, scopes));
  const keep = live
    .filter((i) => i.decision !== 'rejected' && (i.decision === 'accepted' || i.origin !== 'ai'))
    .slice(0, MAX_ENTRIES)
    .map((i) => ({ id: i.id, type: i.type, summary: itemSummary(i) }));
  const avoid = live
    .filter((i) => i.decision === 'rejected')
    .slice(0, MAX_ENTRIES)
    .map((i) => ({ id: i.id, type: i.type, summary: itemSummary(i), ...(i.decisionNote ? { note: i.decisionNote } : {}) }));
  return { keep, avoid };
}

export function isEmptyFeedback(fb: RegenerationFeedback | undefined): boolean {
  return !fb || (fb.keep.length === 0 && fb.avoid.length === 0);
}
