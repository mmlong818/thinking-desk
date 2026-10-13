import type { AttemptEvent, TaskProgress } from '../ai/stream-protocol';

// What the UI shows while a streamed AI action runs: which attempt (a retry starts the text over),
// the answer text received so far and when it started. Pure, so it is tested without React.

export interface StreamProgress {
  attempt: number;
  provider: string;
  model: string;
  /** False when the provider answers in one piece: only the elapsed time moves. */
  streaming: boolean;
  /** Set on a retry: why the previous answer was thrown away. */
  retry?: AttemptEvent['retry'];
  /** Answer text of the current attempt so far. */
  text: string;
  /** ms timestamp of the first event (kept across retries). */
  startedAt: number;
}

export function applyProgress(prev: StreamProgress | null, event: TaskProgress, now: number): StreamProgress {
  if (event.type === 'attempt') {
    const { type: _type, attempt, ...rest } = event;
    return { ...rest, attempt, text: '', startedAt: prev?.startedAt ?? now };
  }
  const base = prev ?? { attempt: event.attempt, provider: '', model: '', streaming: true, text: '', startedAt: now };
  // A late delta of an earlier attempt belongs to the answer that was thrown away.
  if (event.attempt !== base.attempt) return base;
  return { ...base, text: base.text + event.text };
}

/** Rough count of output entities so far: each `"id":` key in the partial JSON. */
export function entityCount(text: string): number {
  return text.match(/"id"\s*:/g)?.length ?? 0;
}

/** The last `max` characters on one line, for a live glimpse of the answer. */
export function textTail(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `…${flat.slice(-max)}` : flat;
}
