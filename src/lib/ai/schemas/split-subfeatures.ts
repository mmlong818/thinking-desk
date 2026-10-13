// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';
import { StanceField } from './stance';

export const SubFeatureSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  layer: z.enum(['frontend', 'backend', 'data', 'ai', 'design', 'test', 'devops', 'mixed']),
  estimate: z.string(),                          // "0.5d" / "2d" / "1w" 等
  acceptance_criteria: z.array(z.string()).min(1),
  dependencies: z.array(z.string()).default([]), // 其它 sub id
});
export type SubFeature = z.infer<typeof SubFeatureSchema>;

/** A subtask as the AI outputs it, with its verdict; the subtask item body stays stance-free. */
export const SubFeatureOutputSchema = SubFeatureSchema.extend({ stance: StanceField });

export const FeatureSplitSchema = z.object({
  feature_id: z.string(),
  feature_name: z.string(),
  module_id: z.string().default(''),
  subfeatures: z.array(SubFeatureOutputSchema).min(1),
});
export type FeatureSplit = z.infer<typeof FeatureSplitSchema>;

export const SubfeatureBreakdownSchema = z.object({
  splits: z.array(FeatureSplitSchema).min(1),
  summary: z.string(),
  total_subfeatures: z.number().int().min(1),
  critical_path: z.array(z.string()).default([]),
});
export type SubfeatureBreakdown = z.infer<typeof SubfeatureBreakdownSchema>;
