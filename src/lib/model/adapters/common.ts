import type { NodeKind } from '../../../data/nodes';
import type { ItemDraft, ReplaceScope } from '../repository';
import type { AiStance, ItemType } from '../types';

// Shared pieces of the task output adapters (TaskOutput → ItemDraft[] + replace scope).
// Adapters are pure and client-safe: the browser runs them on a route's `data` before
// Repository.saveRunOutput. See docs/data-model.md § "AI temp ids → permanent ids and Links".

export interface AdaptedOutput {
  drafts: ItemDraft[];
  /** (node, type) pairs the run regenerates; empty for additive runs. */
  replace: ReplaceScope[];
}

export interface CritiqueLike {
  kind: 'check' | 'critique' | 'ask';
  title: string;
  body: string;
}

export const recommend = (reason: string): AiStance => ({ verdict: 'recommend', reason });
export const caution = (reason: string): AiStance => ({ verdict: 'caution', reason });
export const neutral = (reason: string): AiStance => ({ verdict: 'neutral', reason });

export function scopes(node: NodeKind, ...types: ItemType[]): ReplaceScope[] {
  return types.map((type) => ({ node, type }));
}

export function critiqueDrafts(critiques: readonly CritiqueLike[], node?: NodeKind): ItemDraft[] {
  return critiques.map((c) => ({ type: 'critique', ...(node ? { node } : {}), body: c }));
}

type SummaryTopic = 'priority' | 'differentiation_echo' | 'leap_timing' | 'revision' | 'split';

/** Run-level AI prose as a `summary` item; empty text yields no draft. */
export function summaryDraft(
  topic: SummaryTopic,
  text: string,
  extra: { node?: NodeKind; verdict?: 'bold' | 'selective' | 'minimal' } = {},
): ItemDraft[] {
  if (!text.trim()) return [];
  const { node, verdict } = extra;
  return [{ type: 'summary', ...(node ? { node } : {}), body: { topic, text, ...(verdict ? { verdict } : {}) } }];
}
