'use client';

import { useMemo } from 'react';
import type { NodeKind } from '@/data/nodes';
import { completedNodes, isNodeComplete } from '@/lib/model/completion';
import { contextItems, liveOf, type ItemOfType } from '@/lib/model/context';
import { nodeHints, type NodeHint } from '@/lib/model/hints';
import type { Item } from '@/lib/model/item-types';
import { recommendedPending } from '@/lib/model/plan-item';
import type { ItemType, Link, Run } from '@/lib/model/types';
import { useProject } from './ProjectStore';

export interface NodeData {
  /** True until the project's items have been read once. */
  loading: boolean;
  /** Every live item of the project (upstream nodes included). */
  all: Item[];
  /** Live items of this node. */
  items: Item[];
  links: Link[];
  runs: Run[];
  /** Live items of one type on a node (this node by default). */
  of: <T extends ItemType>(type: T, node?: NodeKind) => ItemOfType<T>[];
  /** What a prompt receives for (node, type): accepted if any, else every non-rejected item. */
  context: <T extends ItemType>(node: NodeKind, type: T) => ItemOfType<T>[];
  hints: NodeHint[];
  complete: boolean;
  completed: Set<NodeKind>;
  /** Pending items on this node the AI recommends ("采纳全部推荐"). */
  recommended: Item[];
}

export function useNodeData(node: NodeKind): NodeData {
  const { snapshot } = useProject();
  return useMemo(() => {
    const all = (snapshot?.items ?? []).filter((i) => !i.deletedAt);
    return {
      loading: snapshot === null,
      all,
      items: all.filter((i) => i.node === node),
      links: snapshot?.links ?? [],
      runs: snapshot?.runs ?? [],
      of: <T extends ItemType>(type: T, on: NodeKind = node) => liveOf(all, on, type),
      context: <T extends ItemType>(on: NodeKind, type: T) => contextItems(all, on, type),
      hints: nodeHints(node, all),
      complete: isNodeComplete(node, all),
      completed: completedNodes(all),
      recommended: recommendedPending(all, node),
    };
  }, [snapshot, node]);
}
