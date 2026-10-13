import type { z } from 'zod';

// Per-browser UI conveniences that are not project content: the brief draft typed before the
// first analysis, derived copilot follow-up questions and their answers (or the last failed
// derivation), a one-shot import notice. localStorage, keyed `td:ui:<projectId>:<key>`; every
// access tolerates a missing or throwing storage, and reads are validated so stale shapes are
// ignored rather than crashing.

const PREFIX = 'td:ui:';

/** The UI cache entries in use. */
export const UI_KEY = {
  /** Raw brief text typed before the first analysis (string). */
  briefDraft: 'brief-draft',
  /** One-shot notice an import leaves for the brief page (string). */
  importNotice: 'import-warning',
  /** Derived copilot follow-ups and their answers for one node. */
  followUps: (node: string) => `followups:${node}`,
  /** The last failed follow-up derivation of one node (no automatic retry for the same inputs). */
  followUpsFailure: (node: string) => `followups-failed:${node}`,
} as const;

const keyOf = (projectId: string, key: string) => `${PREFIX}${projectId}:${key}`;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readUi<S extends z.ZodType>(projectId: string, key: string, schema: S): z.output<S> | null {
  try {
    const raw = storage()?.getItem(keyOf(projectId, key));
    if (!raw) return null;
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeUi(projectId: string, key: string, value: unknown): void {
  try {
    storage()?.setItem(keyOf(projectId, key), JSON.stringify(value));
  } catch {
    // Quota or disabled storage: a UI convenience is lost, nothing else.
  }
}

export function removeUi(projectId: string, key: string): void {
  try {
    storage()?.removeItem(keyOf(projectId, key));
  } catch {
    // ignore
  }
}

function keysOf(s: Storage, projectId: string): string[] {
  const prefix = keyOf(projectId, '');
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k?.startsWith(prefix)) keys.push(k);
  }
  return keys;
}

/** Copies every UI entry of a project to another (project branching). */
export function copyUi(fromId: string, toId: string): void {
  const s = storage();
  if (!s) return;
  try {
    const from = keyOf(fromId, '');
    for (const k of keysOf(s, fromId)) {
      const v = s.getItem(k);
      if (v !== null) s.setItem(keyOf(toId, k.slice(from.length)), v);
    }
  } catch {
    // ignore
  }
}

/** Removes every UI entry of a project (project deletion). */
export function purgeUi(projectId: string): void {
  const s = storage();
  if (!s) return;
  try {
    for (const k of keysOf(s, projectId)) s.removeItem(k);
  } catch {
    // ignore
  }
}
