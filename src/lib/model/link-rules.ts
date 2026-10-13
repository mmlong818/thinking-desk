import type { NodeKind } from '../../data/nodes';
import { ITEM_TYPE_DEFS } from './item-types';
import { ITEM_TYPES, type ItemType, type Link, type LinkRel } from './types';

// Which Links may exist between which item types. The type registry's ref fields are the source
// of truth (every Link an AI run can create comes from one), plus the few links adapters supply
// beyond the ref fields. A person editing Links by hand is held to the same table.

export interface LinkRule {
  from: ItemType;
  rel: LinkRel;
  to: readonly ItemType[];
  /** Only when `from` lives on this node. */
  fromNode?: NodeKind;
  /** Only when `to` lives on this node. */
  toNode?: NodeKind;
}

/** Links adapters add that no ref field declares (see adapters/brief.ts and adapters/final.ts). */
const ADAPTER_RULES: readonly LinkRule[] = [
  { from: 'brief', rel: 'assumes', to: ['assumption'] },
  { from: 'feature', rel: 'derived_from', to: ['feature'], fromNode: 'final', toNode: 'feat' },
];

export const LINK_RULES: readonly LinkRule[] = [
  ...ITEM_TYPES.flatMap((type) =>
    ITEM_TYPE_DEFS[type].refs.map((r): LinkRule => ({ from: type, rel: r.rel, to: r.to, ...(r.node ? { toNode: r.node } : {}) })),
  ),
  ...ADAPTER_RULES,
];

interface Endpoint {
  type: ItemType;
  node: NodeKind;
}

export function linkAllowed(from: Endpoint, rel: LinkRel, to: Endpoint): boolean {
  return LINK_RULES.some((r) =>
    r.from === from.type && r.rel === rel && r.to.includes(to.type) &&
    (!r.fromNode || r.fromNode === from.node) && (!r.toNode || r.toNode === to.node));
}

/** True when adding `from —rel→ to` would close a cycle, i.e. `to` already reaches `from` over `rel`. */
export function createsCycle(links: readonly Link[], from: string, to: string, rel: LinkRel = 'depends_on'): boolean {
  if (from === to) return true;
  const next = new Map<string, string[]>();
  for (const l of links) {
    if (l.rel === rel) next.set(l.from, [...(next.get(l.from) ?? []), l.to]);
  }
  const seen = new Set<string>([to]);
  const queue = [to];
  while (queue.length > 0) {
    const cur = queue.shift() as string;
    for (const n of next.get(cur) ?? []) {
      if (n === from) return true;
      if (!seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return false;
}
