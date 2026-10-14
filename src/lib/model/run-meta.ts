import { z } from 'zod';
import type { NodeKind } from '../../data/nodes';
import { AI_TASKS } from '../ai/types';
import { RUN_STATUSES, RunRetrySchema, UsageSchema, type ItemRef, type RunInput } from './types';

// Run metadata as /api/ai/* routes return it (`run` in the JSON answer), and its mapping onto
// the Run record. Client-safe: the browser turns a route answer into Repository.saveRunOutput input.

export const RunMetaSchema = z.object({
  task: z.enum(AI_TASKS),
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  status: z.enum(RUN_STATUSES),
  attempts: z.number().int().min(0),
  latencyMs: z.number().min(0),
  usage: UsageSchema.optional(),
  /** Stripped from production error answers, like `error`. */
  retry: RunRetrySchema.optional(),
  /** Stripped from production error answers. */
  error: z.string().optional(),
});
export type RunMetaRecord = z.infer<typeof RunMetaSchema>;

/** A Run record (minus id / projectId / createdAt) for Repository.saveRunOutput. */
export function toRunInput(meta: RunMetaRecord, ctx: { node: NodeKind; inputs?: ItemRef[] }): RunInput {
  return {
    task: meta.task, node: ctx.node, provider: meta.provider, model: meta.model,
    promptVersion: meta.promptVersion, inputs: ctx.inputs ?? [], status: meta.status,
    latencyMs: Math.round(meta.latencyMs),
    ...(meta.usage ? { usage: meta.usage } : {}),
    ...(meta.error ? { error: meta.error } : {}),
    ...(meta.retry ? { retry: meta.retry } : {}),
  };
}
