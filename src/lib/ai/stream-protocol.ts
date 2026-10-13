import { z } from 'zod';

// Wire format of a streamed /api/ai/* answer (client-safe). A route that supports streaming
// answers `Accept: application/x-ndjson` with one JSON event per line:
//
//   {"type":"attempt","attempt":1,"provider":"claude","model":"…","streaming":true}
//   {"type":"delta","attempt":1,"text":"{\"dimensions\":{…"}                       (repeated)
//   {"type":"attempt","attempt":2,…,"retry":{"code":"invalid_output","issues":[…]}}  ← restart: drop attempt 1's text
//   {"type":"done","ok":true,"data":…,"run":…}         ← exactly the JSON body of a non-streamed call
//   {"type":"error","status":502,"error":"ai_failed","code":"…","run":…}  ← the error body + its HTTP status
//
// Exactly one `done` or `error` ends the stream. Validation and the one retry are runTask()'s, so
// `data` is the validated output and `run` the same run metadata as without streaming.

export const NDJSON_TYPE = 'application/x-ndjson';

const AttemptEventSchema = z.object({
  type: z.literal('attempt'),
  attempt: z.number().int().min(1),
  provider: z.string(),
  model: z.string(),
  /** False when the provider answers in one piece (no deltas follow, e.g. Gemini). */
  streaming: z.boolean(),
  /** Why this attempt starts over (attempt ≥ 2): the previous answer failed validation. */
  retry: z.object({ code: z.string(), issues: z.array(z.string()) }).optional(),
});

const DeltaEventSchema = z.object({
  type: z.literal('delta'),
  attempt: z.number().int().min(1),
  text: z.string(),
});

const DoneEventSchema = z.object({ type: z.literal('done'), ok: z.literal(true), data: z.unknown(), run: z.unknown() });

const ErrorEventSchema = z.object({
  type: z.literal('error'),
  status: z.number().int(),
  error: z.string(),
  code: z.string().optional(),
  detail: z.string().optional(),
  run: z.unknown().optional(),
});

export const StreamEventSchema = z.discriminatedUnion('type', [
  AttemptEventSchema, DeltaEventSchema, DoneEventSchema, ErrorEventSchema,
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;
export type AttemptEvent = z.infer<typeof AttemptEventSchema>;

/** What runTask() reports while it runs (TaskOptions.onProgress). */
export type TaskProgress = AttemptEvent | z.infer<typeof DeltaEventSchema>;
