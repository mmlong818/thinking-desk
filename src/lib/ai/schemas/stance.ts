// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';

/** The AI's own verdict on one output item; adapters map it onto Item.aiStance. */
export const ItemStanceSchema = z.object({
  verdict: z.enum(['recommend', 'neutral', 'caution']),
  reason: z.string(),
});
export type ItemStance = z.infer<typeof ItemStanceSchema>;

/** What a missing stance parses to; adapters read it as "no judgment" (neutral), never as recommend. */
export const NO_STANCE: ItemStance = { verdict: 'neutral', reason: '' };

/**
 * Per-item stance field. Required in the JSON Schema the provider sees (taskJsonSchema renders
 * the output side of the preprocess), so native structured output always emits it; lenient
 * when parsing, so an answer without it is not failed and retried over a missing verdict.
 */
export const StanceField = z.preprocess((v) => v ?? { ...NO_STANCE }, ItemStanceSchema);
