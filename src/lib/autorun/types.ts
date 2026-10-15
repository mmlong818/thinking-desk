import type { Item } from '../model/item-types';
import type { Usage } from '../model/types';
import type { StepName } from './chain';

export const AUTORUN_STATUSES = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export type AutorunStatus = (typeof AUTORUN_STATUSES)[number];

export type AutorunStepStatus = 'pending' | 'running' | 'ok' | 'retried' | 'failed' | 'skipped';

/** One chain step as GET /api/autorun/[runId] reports it (usage covers every attempt). */
export interface AutorunStep {
  step: StepName;
  task: string;
  status: AutorunStepStatus;
  provider?: string;
  model?: string;
  latencyMs?: number;
  usage?: Partial<Usage>;
  error?: string;
}

export interface AutorunResult {
  prdMarkdown: string;
  design: { sections: Item[]; modules: Item[] };
  split?: { subtasks: Item[] };
}

/** The mutable part of an autorun row. */
export interface AutorunPatch {
  status?: AutorunStatus;
  currentStep?: StepName | null;
  steps?: AutorunStep[];
  error?: string | null;
  result?: AutorunResult;
}

export interface AutorunRow extends Required<Omit<AutorunPatch, 'result' | 'error'>> {
  id: string;
  projectId: string;
  slug: string;
  model: string | null;
  error: string | null;
  projectUrl: string;
  result: AutorunResult | null;
  createdAt: string;
  updatedAt: string;
}

/** Where the runner reports progress (Postgres in the app, memory in tests). */
export interface AutorunSink {
  update(runId: string, patch: AutorunPatch): Promise<void>;
}
