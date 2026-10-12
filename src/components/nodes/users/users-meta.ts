import type { ItemOfType } from '@/lib/model/context';
import type { Run } from '@/lib/model/types';

export type PersonaItem = ItemOfType<'persona'>;
export type JobItem = ItemOfType<'job'>;
export type JobGroupKey = 'functional' | 'emotional' | 'social';

export const GROUP_META: Record<JobGroupKey, { label: string; tag: string; hint: string }> = {
  functional: { label: '功能性 Job', tag: 'FUNCTIONAL', hint: '任务要完成的客观事实' },
  emotional:  { label: '情感性 Job', tag: 'EMOTIONAL',  hint: '任务背后的主观感受' },
  social:     { label: '社交性 Job', tag: 'SOCIAL',     hint: '他人眼里的"我"' },
};

export const MAX_PERSONAS = 10;

export const sortedIds = (items: readonly { id: string }[]) => items.map((i) => i.id).sort();

/**
 * The personas the current Jobs were derived from: the persona inputs of the run that last wrote
 * a job, or — for the initial analysis, whose only input is the brief — the personas that run
 * created. Replaces the old `jobsBasedOn` UI state.
 */
export function jobsBasis(jobs: readonly JobItem[], personas: readonly PersonaItem[], runs: readonly Run[]): string[] {
  const jobRuns = new Set(jobs.map((j) => j.runId).filter((id): id is string => !!id));
  const run = runs.find((r) => jobRuns.has(r.id));
  if (!run) return [];
  const personaIds = new Set(personas.map((p) => p.id));
  const fromInputs = run.inputs.map((i) => i.itemId).filter((id) => personaIds.has(id));
  if (fromInputs.length > 0) return [...new Set(fromInputs)].sort();
  return sortedIds(personas.filter((p) => p.runId === run.id));
}

export const shortName = (p: PersonaItem) => p.body.name.split(' · ')[0];
