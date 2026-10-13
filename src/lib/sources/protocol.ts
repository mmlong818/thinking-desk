// Client-safe contract of POST /api/sources/verify (no node: imports here; the browser and the
// route both validate with these schemas).
import { z } from 'zod';
import { SOURCE_STATUSES } from '../model/types';

export const MAX_SOURCES_PER_REQUEST = 20;

export const SourceCheckRequestSchema = z.object({
  sources: z.array(z.object({
    url: z.string().min(1).max(2048),
    /** The title the source is cited with, if any. */
    title: z.string().max(300).optional(),
    /** What the source is cited for (e.g. the alternative's name): compared when there is no title. */
    subject: z.string().max(200).optional(),
  })).min(1).max(MAX_SOURCES_PER_REQUEST),
});
export type SourceCheckRequest = z.output<typeof SourceCheckRequestSchema>;

export const SourceCheckResultSchema = z.object({
  url: z.string(),
  status: z.enum(SOURCE_STATUSES),
  verified: z.boolean(),
  pageTitle: z.string().optional(),
  httpStatus: z.number().int().optional(),
  finalUrl: z.string().optional(),
  detail: z.string().optional(),
});
export type SourceCheckResult = z.output<typeof SourceCheckResultSchema>;

export const SourceCheckResponseSchema = z.object({
  ok: z.literal(true),
  results: z.array(SourceCheckResultSchema),
});
