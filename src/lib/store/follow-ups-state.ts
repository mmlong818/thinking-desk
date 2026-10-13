import { z } from 'zod';
import { FollowUpItemSchema } from '../ai/follow-ups';
import type { ItemRef } from '../model/types';

// When the copilot follow-ups panel derives questions for a node. They are derived once and kept
// (with their answers) in the UI cache. A failed derivation (e.g. no API key) is remembered too,
// keyed by the node's inputs, so visiting the node again does not call the AI again: it re-derives
// on its own only once the inputs changed, otherwise only when the person presses retry.

export const FollowUpsCacheSchema = z.object({
  items: z.array(FollowUpItemSchema),
  answers: z.record(z.string(), z.string()).default({}),
});
export type FollowUpsCache = z.output<typeof FollowUpsCacheSchema>;

export const FollowUpsFailureSchema = z.object({
  /** inputsKey() of the items the failed derivation was asked about. */
  inputsKey: z.string(),
  message: z.string(),
  at: z.string(),
});
export type FollowUpsFailure = z.output<typeof FollowUpsFailureSchema>;

/** Order-independent fingerprint of the items a derivation reads (ids + versions). */
export function inputsKey(inputs: readonly ItemRef[]): string {
  return inputs.map((r) => `${r.itemId}@${r.version}`).sort().join(',');
}

export type FollowUpsPlan =
  | { kind: 'show'; cache: FollowUpsCache }
  /** Remembered failure for these very inputs: show it with a retry button, do not call the AI. */
  | { kind: 'failed'; message: string }
  | { kind: 'derive' }
  | { kind: 'idle' };

export function planFollowUps(args: {
  cache: FollowUpsCache | null;
  failure: FollowUpsFailure | null;
  inputs: readonly ItemRef[];
}): FollowUpsPlan {
  if (args.cache) return { kind: 'show', cache: args.cache };
  if (args.inputs.length === 0) return { kind: 'idle' };
  if (args.failure && args.failure.inputsKey === inputsKey(args.inputs)) {
    return { kind: 'failed', message: args.failure.message };
  }
  return { kind: 'derive' };
}

export function failureRecord(inputs: readonly ItemRef[], message: string, now: Date = new Date()): FollowUpsFailure {
  return { inputsKey: inputsKey(inputs), message, at: now.toISOString() };
}
