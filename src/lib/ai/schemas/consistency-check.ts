// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';
import { StanceField } from './stance';

export const FINDING_SEVERITIES = ['high', 'medium', 'low'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

export const SEVERITY_LABEL: Record<FindingSeverity, string> = { high: '严重', medium: '中等', low: '轻微' };

/** One contradiction between accepted decisions, as the AI reports it. */
export const ConsistencyFindingSchema = z.object({
  /** Permanent ids of the items involved, exactly as the request listed them. */
  item_ids: z.array(z.string()).min(1).max(8),
  title: z.string(),
  description: z.string(),
  severity: z.enum(FINDING_SEVERITIES),
  suggested_fix: z.string(),
  stance: StanceField,
});
export type ConsistencyFinding = z.infer<typeof ConsistencyFindingSchema>;

export const ConsistencyCheckSchema = z.object({
  findings: z.array(ConsistencyFindingSchema).max(12),
});
export type ConsistencyCheck = z.infer<typeof ConsistencyCheckSchema>;

/** One item as the consistency prompt reads it (built in the browser from the project's items). */
export const ConsistencyItemSchema = z.object({
  id: z.string().min(1).max(100),
  type: z.string().min(1).max(40),
  node: z.string().min(1).max(20),
  decision: z.enum(['accepted', 'pending']),
  text: z.string().max(1200),
  /** Outgoing Links as `rel:targetId`. */
  links: z.array(z.string().max(160)).max(40).default([]),
});
export type ConsistencyItem = z.output<typeof ConsistencyItemSchema>;

export const MAX_CONSISTENCY_ITEMS = 300;
