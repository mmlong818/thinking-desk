import { NODES, type NodeKind } from '../../data/nodes';
import { itemSummary } from './feedback';
import type { Item } from './item-types';
import type { ItemType } from './types';

// The cross-node summary the copilot's free-form answers read: for every node up to the
// current one, the items the person kept (accepted first, never rejected), one line each.

const SKIP: ReadonlySet<ItemType> = new Set(['summary', 'critique', 'matrix_cell', 'alt_breakdown']);
const PER_NODE = 12;
const MAX_CHARS = 6000;

const MARK = { accepted: '已采纳', pending: '待定', rejected: '' } as const;

function nodeLines(items: readonly Item[], kind: NodeKind): string[] {
  const kept = items.filter((i) => i.node === kind && !i.deletedAt && i.decision !== 'rejected' && !SKIP.has(i.type));
  const ordered = [...kept.filter((i) => i.decision === 'accepted'), ...kept.filter((i) => i.decision === 'pending')];
  return ordered.slice(0, PER_NODE).map((i) => `- [${i.type}·${MARK[i.decision]}] ${itemSummary(i)}`);
}

export function copilotContext(items: readonly Item[], current: NodeKind): string {
  const upTo = NODES.findIndex((n) => n.kind === current);
  const blocks = NODES.slice(0, upTo + 1).flatMap((n) => {
    const lines = nodeLines(items, n.kind);
    return lines.length > 0 ? [`## ${n.num} ${n.label}\n${lines.join('\n')}`] : [];
  });
  const text = blocks.join('\n\n');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n…（已截断）` : text;
}
