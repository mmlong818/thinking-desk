import { NODES, type NodeKind } from '../../data/nodes';
import type { Item } from './item-types';

// "Missing recommended things" per node. Hints only: they never affect
// completion or locking (completion stays the minimal rules in data/nodes.ts).

export type HintCode =
  | 'brief.no_red_line'
  | 'brief.no_success_criteria'
  | 'users.no_emotional_job'
  | 'stake.missing_baseline'
  | 'alt.no_non_consumption'
  | 'scen.no_hostile'
  | 'feat.no_not_doing';

export interface NodeHint {
  node: NodeKind;
  code: HintCode;
  message: string;
  /** e.g. { category: 'compliance' } for stake.missing_baseline. */
  params?: Record<string, string>;
}

/** Baseline stakeholders the STAKE_MATRIX prompt asks for (required: true). */
export const BASELINE_STAKEHOLDERS = {
  sponsor: '项目发起人 / 决策层',
  maker: '设计 / 产品团队',
  business: '使用者背后的组织 / 业务方',
  compliance: '合规 / 法务 / 监管',
  user: '终端用户群体',
} as const;

type Rule = (accepted: readonly Item[]) => Omit<NodeHint, 'node'>[];

const of = <T extends Item['type']>(items: readonly Item[], type: T): Extract<Item, { type: T }>[] =>
  items.filter((i): i is Extract<Item, { type: T }> => i.type === type);

const unless = (ok: boolean, code: HintCode, message: string): Omit<NodeHint, 'node'>[] =>
  ok ? [] : [{ code, message }];

const RULES: Partial<Record<NodeKind, readonly Rule[]>> = {
  brief: [
    (a) => unless(of(a, 'red_line').length > 0, 'brief.no_red_line', '还没有采纳任何道德红线'),
    (a) => unless(
      of(a, 'brief').some((b) => !!b.body.fields.success_criteria),
      'brief.no_success_criteria',
      '已采纳的 Brief 还没有成功标准',
    ),
  ],
  users: [
    (a) => unless(
      of(a, 'job').some((j) => j.body.dimension === 'emotional'),
      'users.no_emotional_job',
      '还没有采纳情感性 Job',
    ),
  ],
  stake: [
    (a) => {
      const covered = new Set(of(a, 'stakeholder').map((s) => s.body.category));
      return Object.entries(BASELINE_STAKEHOLDERS)
        .filter(([category]) => !covered.has(category as keyof typeof BASELINE_STAKEHOLDERS))
        .map(([category, label]) => ({
          code: 'stake.missing_baseline' as const,
          message: `还没有采纳基线干系人：${label}`,
          params: { category },
        }));
    },
  ],
  alt: [
    (a) => unless(
      of(a, 'alternative').some((x) => x.body.category === 'non_consumption'),
      'alt.no_non_consumption',
      '还没有采纳非消费替代',
    ),
  ],
  scen: [(a) => unless(of(a, 'hostile').length > 0, 'scen.no_hostile', '还没有采纳敌意情景')],
  feat: [(a) => unless(of(a, 'not_doing').length > 0, 'feat.no_not_doing', '还没有采纳"不做什么"')],
};

/**
 * Recommended-but-missing things for one node, judged on its live accepted items.
 * Empty for a node with no live items yet (it simply has not started).
 */
export function nodeHints(kind: NodeKind, items: readonly Item[]): NodeHint[] {
  const live = items.filter((i) => i.node === kind && !i.deletedAt);
  if (live.length === 0) return [];
  const accepted = live.filter((i) => i.decision === 'accepted');
  return (RULES[kind] ?? []).flatMap((rule) => rule(accepted)).map((h) => ({ node: kind, ...h }));
}

/** nodeHints for every node, in NODES order; nodes without hints are omitted. */
export function projectHints(items: readonly Item[]): Partial<Record<NodeKind, NodeHint[]>> {
  const out: Partial<Record<NodeKind, NodeHint[]>> = {};
  for (const { kind } of NODES) {
    const hints = nodeHints(kind, items);
    if (hints.length > 0) out[kind] = hints;
  }
  return out;
}
