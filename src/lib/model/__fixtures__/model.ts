import type { IdSource } from '../ids';
import { asItem, type Item } from '../item-types';
import type { RunOutputInput } from '../repository';
import type { ItemRecord, RunInput } from '../types';

export const PROJECT = 'proj-1';
export const T0 = '2026-10-13T00:00:00.000Z';
export const T1 = '2026-10-13T01:00:00.000Z';

/** Deterministic ids: 00000001, 00000002, … */
export function seqIdSource(): IdSource {
  let n = 0;
  return (length) => {
    n += 1;
    return n.toString(36).padStart(length, '0');
  };
}

export const personaBody = (name = 'P') => ({
  role: 'candidate', name, one_liner: 'o', meta: 'm', story: 's', pain: 'p',
});

export const jobBody = (title = 'J') => ({
  title, reach: 5, impact: 2, source: 's', dimension: 'functional',
});

export const briefBody = (problem: string | null = 'p', rawText = 'r') => ({
  raw_text: rawText,
  fields: {
    problem_statement: problem, target_user: null, scenario: null, value_prop: null,
    success_criteria: null, time_constraint: null, boundaries: [],
  },
});

/** Raw AI entities, still carrying temp ids and cross-ref fields. */
export const rawPersona = (id: string, name = 'P') => ({ id, ...personaBody(name) });
export const rawJob = (id: string, personaIds: string[] = [], title = 'J') => ({
  id, ...jobBody(title), persona_ids: personaIds, suggested_priority: false,
});

export function makeItem(overrides: Partial<ItemRecord> & { id: string }): Item {
  return asItem({
    projectId: PROJECT,
    node: 'users',
    type: 'persona',
    body: personaBody(),
    origin: 'ai',
    decision: 'pending',
    version: 1,
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  });
}

export function runInput(overrides: Partial<RunInput> = {}): RunInput {
  return {
    task: 'USERS_JTBD',
    node: 'users',
    provider: 'claude',
    model: 'claude-sonnet-4-6',
    promptVersion: 'sha256:abc',
    inputs: [],
    status: 'ok',
    latencyMs: 1200,
    ...overrides,
  };
}

export function output(partial: Partial<RunOutputInput> = {}): RunOutputInput {
  return { run: runInput(), drafts: [], replace: [], ...partial };
}
