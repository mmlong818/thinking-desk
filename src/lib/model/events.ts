import type { IdAllocator } from './ids';
import type { Actor, Decision, DecisionEvent, EventKind } from './types';

export interface EventSpec {
  itemId: string;
  kind: EventKind;
  fromVersion: number;
  toVersion: number;
  actor: Actor;
  note?: string;
  prevBody?: unknown;
}

export function makeEvent(spec: EventSpec, projectId: string, at: string, alloc: IdAllocator): DecisionEvent {
  const { note, prevBody, ...rest } = spec;
  return {
    id: alloc('evt'), projectId, ...rest,
    ...(note ? { note } : {}),
    ...(prevBody !== undefined ? { prevBody } : {}),
    at,
  };
}

export function decisionEventKind(decision: Decision): EventKind {
  if (decision === 'accepted') return 'accepted';
  if (decision === 'rejected') return 'rejected';
  return 'reset';
}
