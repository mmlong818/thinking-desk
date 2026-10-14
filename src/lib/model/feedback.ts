import { z } from 'zod';
import { indexById, isStale } from './graph';
import type { Item, ItemBody } from './item-types';
import { inScope } from './regenerate';
import type { ReplaceScope } from './repository';
import { ItemTypeSchema, type ItemType, type Link } from './types';

// Feedback a regenerating run hands the AI (docs/data-model.md § "Regeneration"): what the person
// kept or touched — don't duplicate it, refer to it by id — what they rejected, with their
// reason, so the next output steers away from it, and what they kept but whose upstream has
// changed since (stale Links), so the AI may propose an updated version next to it.

const FeedbackEntry = z.object({
  id: z.string().min(1).max(100),
  type: ItemTypeSchema,
  summary: z.string().max(400),
});

export const RegenerationFeedbackSchema = z.object({
  keep: z.array(FeedbackEntry).max(60).default([]),
  avoid: z.array(FeedbackEntry.extend({ note: z.string().max(1000).optional() })).max(60).default([]),
  /** Kept items whose upstream changed after they were made: `changed` names the new upstream. */
  revisit: z.array(FeedbackEntry.extend({ changed: z.string().max(600) })).max(60).default([]),
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
  finding: (b) => b.title,
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
  return bodySummary(item.type, item.body);
}

const SHORT_NAME_MAX = 24;

/** The name part of a summary ("名称 · 描述" → "名称"), for citing an item inside a sentence. */
export function shortName(summary: string): string {
  const head = summary.split(/ · | → /)[0].trim();
  return head.length > SHORT_NAME_MAX ? `${head.slice(0, SHORT_NAME_MAX - 1)}…` : head;
}

/** itemSummary for a body that is not an Item yet (a draft being planned). */
export function bodySummary(type: ItemType, body: unknown): string {
  const fn = SUMMARY[type] as (b: unknown) => string;
  return clip(fn(body));
}

/** "<type> <summary>" of each upstream item whose change made `item` stale, or '' when it is not stale. */
function changedUpstream(item: Item, links: readonly Link[], byId: ReadonlyMap<string, Item>): string {
  const changed = links
    .filter((l) => l.from === item.id && isStale(l, byId))
    .map((l) => byId.get(l.to))
    .filter((to): to is Item => !!to)
    .map((to) => `${to.type} [${to.id}] ${itemSummary(to)}`);
  return changed.slice(0, 4).join('；');
}

/**
 * Kept = accepted or human-touched (not rejected); avoided = rejected, with the decision note.
 * With `links`, a kept item whose upstream changed since its Link was made goes to `revisit`
 * instead of `keep` (it still survives the run; the AI is asked to check it against the change).
 */
export function buildFeedback(
  items: readonly Item[], scopes: readonly ReplaceScope[], links: readonly Link[] = [],
): RegenerationFeedback {
  const live = items.filter((i) => !i.deletedAt && inScope(i, scopes));
  const byId = indexById(items);
  const kept = live
    .filter((i) => i.decision !== 'rejected' && (i.decision === 'accepted' || i.origin !== 'ai'))
    .map((i) => ({ item: i, changed: changedUpstream(i, links, byId) }));
  const keep = kept
    .filter((k) => !k.changed)
    .slice(0, MAX_ENTRIES)
    .map(({ item: i }) => ({ id: i.id, type: i.type, summary: itemSummary(i) }));
  const revisit = kept
    .filter((k) => k.changed)
    .slice(0, MAX_ENTRIES)
    .map(({ item: i, changed }) => ({ id: i.id, type: i.type, summary: itemSummary(i), changed }));
  const avoid = live
    .filter((i) => i.decision === 'rejected')
    .slice(0, MAX_ENTRIES)
    .map((i) => ({ id: i.id, type: i.type, summary: itemSummary(i), ...(i.decisionNote ? { note: i.decisionNote } : {}) }));
  return { keep, avoid, revisit };
}

export function isEmptyFeedback(fb: RegenerationFeedback | undefined): boolean {
  return !fb || (fb.keep.length === 0 && fb.avoid.length === 0 && fb.revisit.length === 0);
}
