import type { IdAllocator } from './ids';
import type { Actor, Decision, DecisionEvent, EventKind, EventLink } from './types';

export interface EventSpec {
  itemId: string;
  kind: EventKind;
  fromVersion: number;
  toVersion: number;
  actor: Actor;
  note?: string;
  prevBody?: unknown;
  link?: EventLink;
}

/**
 * `prevBody` is kept on an `edited` event only when the previous body serializes to at most this
 * many characters (bodies are small; a long pasted brief is the exception). An AI rewrite of a
 * singleton always keeps it, whatever the size.
 */
export const PREV_BODY_MAX_CHARS = 16_000;

/** The previous body to record on an `edited` event, or undefined when it is too large to keep. */
export function keptPrevBody(body: unknown, always = false): unknown {
  if (always) return body;
  return JSON.stringify(body).length <= PREV_BODY_MAX_CHARS ? body : undefined;
}

export function makeEvent(spec: EventSpec, projectId: string, at: string, alloc: IdAllocator): DecisionEvent {
  const { note, prevBody, link, ...rest } = spec;
  return {
    id: alloc('evt'), projectId, ...rest,
    ...(note ? { note } : {}),
    ...(prevBody !== undefined ? { prevBody } : {}),
    ...(link ? { link } : {}),
    at,
  };
}

export function decisionEventKind(decision: Decision): EventKind {
  if (decision === 'accepted') return 'accepted';
  if (decision === 'rejected') return 'rejected';
  return 'reset';
}
