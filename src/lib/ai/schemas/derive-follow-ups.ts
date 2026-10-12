// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';
import { FollowUpItemSchema } from '../follow-ups';

export const DeriveFollowUpsResultSchema = z.object({
  follow_ups: z.array(FollowUpItemSchema).max(5).default([]),
});
export type DeriveFollowUpsResult = z.infer<typeof DeriveFollowUpsResultSchema>;
