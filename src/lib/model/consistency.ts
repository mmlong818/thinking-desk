import { NODES, type NodeKind } from '../../data/nodes';
import { indexById, type Graph } from './graph';
import { itemSummary, shortName } from './feedback';
import type { Item } from './item-types';
import type { Link, LinkRel } from './types';

// Rule layer of the consistency check: deterministic, no AI, recomputed on every graph change.
// Findings never block anything; they point the person at gaps between accepted decisions.
// Judged on live accepted items, like the node hints. The AI layer (CONSISTENCY_CHECK) looks
// for contradictions in meaning; these rules only look at structure and explicit marks.
//
// Links into soft-deleted items are not in the live graph, so "points at a deleted item" shows
// up through the rules that ask for an accepted target (feature / module / job).

export type RuleCode =
  | 'feature.no_job'
  | 'module.no_feature'
  | 'subtask.no_target'
  | 'feature.no_subtask'
  | 'feature.red_line_risk'
  | 'finding.unresolved'
  | 'link.to_rejected';

export interface RuleFinding {
  code: RuleCode;
  /** Node of the item the finding is about (the first of itemIds). */
  node: NodeKind;
  itemIds: string[];
  message: string;
  severity: 'warn' | 'info';
}

interface Ctx {
  byId: ReadonlyMap<string, Item>;
  links: readonly Link[];
  accepted: readonly Item[];
}

const name = (i: Item) => `「${shortName(itemSummary(i))}」`;

function targets(ctx: Ctx, from: string, rel: LinkRel): Item[] {
  return ctx.links
    .filter((l) => l.from === from && l.rel === rel)
    .map((l) => ctx.byId.get(l.to))
    .filter((i): i is Item => !!i);
}

const isAccepted = (i: Item) => i.decision === 'accepted';
const finding = (code: RuleCode, item: Item, message: string, severity: RuleFinding['severity'] = 'warn', more: Item[] = []): RuleFinding =>
  ({ code, node: item.node, itemIds: [item.id, ...more.map((m) => m.id)], message, severity });

/**
 * Final-list features that no accepted subtask reaches, directly or through an accepted module.
 * Silent until some subtask is accepted, so an unsplit project is not one finding per feature.
 */
function noSubtaskRule(ctx: Ctx): RuleFinding[] {
  const subtasks = ctx.accepted.filter((i) => i.type === 'subtask');
  if (subtasks.length === 0) return [];
  const reached = new Set<string>();
  for (const s of subtasks) {
    for (const t of [...targets(ctx, s.id, 'implements'), ...targets(ctx, s.id, 'derived_from')]) {
      if (!isAccepted(t)) continue;
      if (t.type === 'feature') reached.add(t.id);
      if (t.type === 'module') targets(ctx, t.id, 'implements').forEach((f) => reached.add(f.id));
    }
  }
  return ctx.accepted
    .filter((i) => i.type === 'feature' && i.node === 'final' && !reached.has(i.id))
    .map((i) => finding('feature.no_subtask', i, `功能${name(i)}还没有任何已采纳的子任务`, 'info'));
}

const servesAcceptedJob = (ctx: Ctx, id: string) => targets(ctx, id, 'serves').some((t) => t.type === 'job' && isAccepted(t));

/** A final-list feature revised from a 06 feature serves that feature's jobs (it carries no serves links of its own). */
const servesJob = (ctx: Ctx, feature: Item) => servesAcceptedJob(ctx, feature.id)
  || targets(ctx, feature.id, 'derived_from').some((t) => t.type === 'feature' && servesAcceptedJob(ctx, t.id));

const RULES: ReadonlyArray<(ctx: Ctx) => RuleFinding[]> = [
  (ctx) => ctx.accepted
    .filter((i) => i.type === 'feature' && !servesJob(ctx, i))
    .map((i) => finding('feature.no_job', i, `功能${name(i)}没有服务任何已采纳的 Job`, 'info')),
  (ctx) => ctx.accepted
    .filter((i) => i.type === 'module' && !targets(ctx, i.id, 'implements').some((t) => t.type === 'feature' && isAccepted(t)))
    .map((i) => finding('module.no_feature', i, `模块${name(i)}没有实现任何已采纳的功能`)),
  (ctx) => ctx.accepted
    .filter((i) => i.type === 'subtask')
    .filter((i) => ![...targets(ctx, i.id, 'implements'), ...targets(ctx, i.id, 'derived_from')]
      .some((t) => (t.type === 'feature' || t.type === 'module') && isAccepted(t)))
    .map((i) => finding('subtask.no_target', i, `子任务${name(i)}没有落到任何已采纳的功能或模块上`)),
  noSubtaskRule,
  (ctx) => ctx.accepted
    .filter((i): i is Extract<Item, { type: 'feature' }> => i.type === 'feature' && i.body.red_line_risk)
    .map((i) => finding('feature.red_line_risk', i,
      `已采纳的功能${name(i)}被 AI 标记为可能触碰道德红线${i.body.ethics_concern ? `：${i.body.ethics_concern}` : ''}`)),
  (ctx) => ctx.accepted
    .filter((i) => i.type === 'finding')
    .flatMap((f) => {
      const involved = targets(ctx, f.id, 'conflicts_with');
      if (involved.length === 0 || !involved.every(isAccepted)) return [];
      return [finding('finding.unresolved', f, `你确认了矛盾${name(f)}，但涉及的条目仍都处于采纳状态`, 'warn', involved)];
    }),
  (ctx) => ctx.accepted
    .filter((i) => i.type !== 'finding')
    .flatMap((i) => ctx.links
      .filter((l) => l.from === i.id && l.rel !== 'conflicts_with')
      .map((l) => ctx.byId.get(l.to))
      .filter((t): t is Item => !!t && t.decision === 'rejected')
      .map((t) => finding('link.to_rejected', i, `${name(i)}依赖的${name(t)}已被否决`, 'warn', [t]))),
];

const NODE_ORDER = new Map(NODES.map((n, i) => [n.kind, i]));

/** Every rule finding of the project, in node order. Pass the live graph. */
export function ruleFindings(graph: Graph): RuleFinding[] {
  const ctx: Ctx = { byId: indexById(graph.items), links: graph.links, accepted: graph.items.filter(isAccepted) };
  return RULES.flatMap((rule) => rule(ctx))
    .sort((a, b) => (NODE_ORDER.get(a.node) ?? 0) - (NODE_ORDER.get(b.node) ?? 0));
}

/** Findings about an item on `node` (the subject or any involved item). */
export function findingsOnNode(findings: readonly RuleFinding[], node: NodeKind, byId: ReadonlyMap<string, Item>): RuleFinding[] {
  return findings.filter((f) => f.itemIds.some((id) => byId.get(id)?.node === node));
}
