'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { NodeKind } from '@/data/nodes';
import type { Item } from '@/lib/model/item-types';
import type { ItemType } from '@/lib/model/types';

// "让 AI 按新内容重做": each node page hands its regenerate actions to the stale-content UI, so a
// stale item (or the node notice) can re-run the task that produces it. Re-running follows the
// usual regeneration semantics: accepted / edited items stay, and stale ones go to the prompt as
// "revisit" feedback (buildFeedback with the links).

export interface RedoHandler {
  /** Button text after "让 AI 按新内容重做 · ". */
  label: string;
  /** Item types this action regenerates. */
  types: readonly ItemType[];
  /** Only items on this node (types such as `feature` live on two nodes). */
  node?: NodeKind;
  run: () => void;
  /** True while this node's AI action is running. */
  busy?: boolean;
}

const RedoContext = createContext<readonly RedoHandler[]>([]);

export function RedoProvider({ handlers, children }: { handlers?: readonly RedoHandler[]; children: ReactNode }) {
  return <RedoContext.Provider value={handlers ?? []}>{children}</RedoContext.Provider>;
}

export function useRedoHandlers(): readonly RedoHandler[] {
  return useContext(RedoContext);
}

export function handlerFor(handlers: readonly RedoHandler[], item: Pick<Item, 'type' | 'node'>): RedoHandler | undefined {
  return handlers.find((h) => h.types.includes(item.type) && (!h.node || h.node === item.node));
}
