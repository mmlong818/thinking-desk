import { NODES, type NodeKind } from '../../../data/nodes';
import type { ConsistencyCheck } from '../../ai/schemas/consistency-check';
import type { ItemDraft, ReplaceScope } from '../repository';
import { modelStance, type AdaptedOutput } from './common';

export interface ConsistencyContext {
  /** Node of every item the request listed (ids the AI may cite). */
  nodeOf: ReadonlyMap<string, NodeKind>;
  /** Where the run was started; findings citing no known item would land here, but are dropped. */
  runNode: NodeKind;
}

const ORDER = new Map(NODES.map((n, i) => [n.kind, i]));

/** The most downstream node among the cited items: where the contradiction is usually fixed. */
function homeNode(ids: readonly string[], ctx: ConsistencyContext): NodeKind {
  const nodes = ids.map((id) => ctx.nodeOf.get(id)).filter((n): n is NodeKind => !!n);
  return nodes.reduce((a, b) => ((ORDER.get(b) ?? 0) > (ORDER.get(a) ?? 0) ? b : a), nodes[0] ?? ctx.runNode);
}

/** Every node's findings: the check returns the complete current set, so an empty answer is valid. */
export const CONSISTENCY_SCOPES: ReplaceScope[] = NODES.map((n) => ({ node: n.kind, type: 'finding', exhaustive: true }));

/**
 * CONSISTENCY_CHECK → one `finding` per reported contradiction, placed on the most downstream node
 * it involves, linked conflicts_with to each cited item (the type registry's `item_ids` ref), with
 * the model's own verdict as aiStance. Findings that cite no item of the request (made-up ids) are
 * dropped. A re-run retires the pending findings of every node; judged ones stay.
 */
export function adaptConsistencyCheck(out: ConsistencyCheck, ctx: ConsistencyContext): AdaptedOutput {
  const drafts = out.findings
    .filter((f) => f.item_ids.some((id) => ctx.nodeOf.has(id)))
    .map(({ stance, ...f }): ItemDraft => ({
      type: 'finding',
      node: homeNode(f.item_ids, ctx),
      body: { ...f, item_ids: f.item_ids.filter((id) => ctx.nodeOf.has(id)) },
      aiStance: modelStance(stance),
    }));
  return { drafts, replace: CONSISTENCY_SCOPES };
}
