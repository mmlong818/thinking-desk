import { query } from '../db/client';
import { PgRepository } from '../db/pg-repository';
import { createProject } from '../db/projects';
import { executeAutorun, pendingSteps } from './runner';
import type { AutorunPatch, AutorunRow, AutorunSink } from './types';

// Postgres-backed autoruns, executed in this server process. Live state (queue, abort handles)
// sits on globalThis so dev hot reloads keep it. A row still queued / running that this process is
// not working on is dead — left by an earlier process ('server_restarted'), or ended while its
// failure could not be written (the database was down) — and is marked failed when read.

const MAX_CONCURRENT = Math.max(1, Number(process.env.AUTORUN_CONCURRENCY) || 2);

interface Pending {
  runId: string;
  projectId: string;
  projectName: string;
  rawText: string;
  model?: string;
}

interface Live {
  running: Map<string, AbortController>;
  queue: Pending[];
  /** Why a run ended when writing that down failed. */
  lost: Map<string, string>;
}

declare global {
  var __autorun: Live | undefined;
}

const live = (): Live => (globalThis.__autorun ??= { running: new Map(), queue: [], lost: new Map() });

const COLUMNS: Record<keyof AutorunPatch, string> = {
  status: 'status', currentStep: 'current_step', steps: 'steps', error: 'error', result: 'result',
};
const JSON_COLUMNS = new Set<keyof AutorunPatch>(['steps', 'result']);

export const pgSink: AutorunSink = {
  async update(runId, patch) {
    const keys = (Object.keys(patch) as (keyof AutorunPatch)[]).filter((k) => patch[k] !== undefined);
    if (keys.length === 0) return;
    const sets = keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`);
    const values = keys.map((k) => (JSON_COLUMNS.has(k) ? JSON.stringify(patch[k]) : patch[k]));
    await query(`UPDATE autoruns SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`, [runId, ...values]);
  },
};

function pump(): void {
  const state = live();
  while (state.running.size < MAX_CONCURRENT && state.queue.length > 0) {
    const job = state.queue.shift();
    if (!job) break;
    const controller = new AbortController();
    state.running.set(job.runId, controller);
    executeAutorun({ ...job, signal: controller.signal }, { repo: new PgRepository(), sink: pgSink })
      .catch((e: unknown) => {
        const error = e instanceof Error ? e.message : String(e);
        return pgSink.update(job.runId, { status: 'failed', currentStep: null, error }).catch((recordError: unknown) => {
          state.lost.set(job.runId, error);
          console.error('[autorun] could not record the failure:', recordError);
        });
      })
      .finally(() => {
        state.running.delete(job.runId);
        pump();
      });
  }
}

export interface StartInput {
  name: string;
  rawText: string;
  model?: string;
  /** Origin the person opens the project at (projectUrl). */
  origin: string;
}

export async function startAutorun(input: StartInput): Promise<AutorunRow> {
  const project = await createProject({ name: input.name, summary: input.rawText.slice(0, 200) });
  const projectUrl = `${input.origin}/project/${encodeURIComponent(project.slug)}/final`;
  const [row] = await query<{ id: string }>(
    `INSERT INTO autoruns (project_id, status, steps, model, project_url) VALUES ($1, 'queued', $2, $3, $4) RETURNING id`,
    [project.id, JSON.stringify(pendingSteps()), input.model ?? null, projectUrl],
  );
  live().queue.push({ runId: row.id, projectId: project.id, projectName: input.name, rawText: input.rawText, model: input.model });
  pump();
  const created = await getAutorun(row.id);
  if (!created) throw new Error('autorun row vanished');
  return created;
}

interface DbRow {
  id: string;
  project_id: string;
  slug: string;
  status: AutorunRow['status'];
  current_step: AutorunRow['currentStep'];
  steps: AutorunRow['steps'];
  model: string | null;
  error: string | null;
  project_url: string;
  result: AutorunRow['result'];
  created_at: Date;
  updated_at: Date;
}

const isLive = (runId: string): boolean => live().running.has(runId) || live().queue.some((j) => j.runId === runId);

export async function getAutorun(runId: string): Promise<AutorunRow | null> {
  const rows = await query<DbRow>(
    `SELECT a.*, p.slug FROM autoruns a JOIN projects p ON p.id = a.project_id WHERE a.id = $1`,
    [runId],
  );
  const r = rows[0];
  if (!r) return null;
  if ((r.status === 'queued' || r.status === 'running') && !isLive(r.id)) {
    const error = live().lost.get(r.id) ?? 'server_restarted';
    await pgSink.update(r.id, { status: 'failed', currentStep: null, error });
    live().lost.delete(r.id);
    Object.assign(r, { status: 'failed', current_step: null, error });
  }
  return {
    id: r.id, projectId: r.project_id, slug: r.slug, status: r.status, currentStep: r.current_step,
    steps: r.steps, model: r.model, error: r.error, projectUrl: r.project_url, result: r.result,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
  };
}

/** 'cancelled' once stopped; null for an unknown run; the row's status when it already ended. */
export async function cancelAutorun(runId: string): Promise<AutorunRow['status'] | null> {
  const row = await getAutorun(runId);
  if (!row) return null;
  if (row.status !== 'queued' && row.status !== 'running') return row.status;
  const state = live();
  const queued = state.queue.findIndex((j) => j.runId === runId);
  if (queued >= 0) state.queue.splice(queued, 1);
  // A running chain stops at its current call; its last report says 'cancelled' again.
  state.running.get(runId)?.abort();
  await pgSink.update(runId, { status: 'cancelled', currentStep: null });
  return 'cancelled';
}
