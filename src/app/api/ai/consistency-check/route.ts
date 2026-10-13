import { z } from 'zod';
import { aiRoute, ModelOverrideSchema } from '@/lib/ai/route';
import { ConsistencyItemSchema, MAX_CONSISTENCY_ITEMS } from '@/lib/ai/schemas/consistency-check';
import { consistencyCheck } from '@/lib/ai/tasks/consistency-check';
import { RegenerationFeedbackSchema } from '@/lib/model/feedback';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  projectSlug: z.string().min(1),
  items: z.array(ConsistencyItemSchema).min(1).max(MAX_CONSISTENCY_ITEMS),
  model: ModelOverrideSchema,
  /** Judged findings of earlier checks: accepted → keep (do not repeat), rejected → avoid. */
  feedback: RegenerationFeedbackSchema.optional(),
});

/** Manual, cross-node consistency check over the accepted items (one AI call). */
export const POST = aiRoute({
  name: 'consistency-check',
  body: Body,
  timeoutMs: 290_000,
  handle: (body, opts) => consistencyCheck({ items: body.items, feedback: body.feedback }, opts),
});
