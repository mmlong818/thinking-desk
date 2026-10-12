// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';
import { FeatureSchema, PillarSchema } from './draft-features';
import { BriefExtractionSchema } from './extract-brief';
import { DesignInsightSchema, PainPointSchema } from './analyze-scenarios';
import { AnalogyTransferSchema, ConstraintFlipSchema, FirstPrincipleRethinkSchema } from './creative-leap';
import { DataEntitySchema, ModuleSchema, UserFlowSchema } from './generate-design';

// Upstream snapshots an AI request carries (the UI still sends node data in the body).
// Each schema keeps exactly the fields the prompt reads, with their types, and drops the
// count rules of the AI output schemas: a human edit such as a user flow cut down to one step
// or a design with a single module must still be accepted. Unknown keys are stripped.

export const BriefSnapshotSchema = z.object({
  highlights: BriefExtractionSchema.shape.highlights.default([]),
  fields: BriefExtractionSchema.shape.fields,
});
/** The parts of a brief that prompts quote. */
export type BriefContext = z.output<typeof BriefSnapshotSchema>;

export const FeatureDigestSchema = FeatureSchema.pick({
  id: true, name: true, description: true, pillar: true, kano: true, rice_score: true,
  core_hypothesis: true, validation_metric: true,
});
export type FeatureDigest = z.output<typeof FeatureDigestSchema>;

export const FeatureListSnapshotSchema = z.object({
  features: z.array(FeatureDigestSchema),
  pillars: z.array(PillarSchema).default([]),
  differentiation_echo: z.string().default(''),
});
export type FeatureListSnapshot = z.output<typeof FeatureListSnapshotSchema>;

export const InsightDigestSchema = DesignInsightSchema.pick({
  id: true, scenario_id: true, job_id: true, insight_text: true, action: true,
});
export type InsightDigest = z.output<typeof InsightDigestSchema>;

export const PainDigestSchema = PainPointSchema.pick({ id: true, moment: true, root_cause: true });
export type PainDigest = z.output<typeof PainDigestSchema>;

export const LeapSnapshotSchema = z.object({
  first_principles: z.array(FirstPrincipleRethinkSchema.pick({
    id: true, industry_assumption: true, physical_floor: true, opportunity: true,
  })).default([]),
  analogies: z.array(AnalogyTransferSchema.pick({
    id: true, core_essence: true, source_domain: true, transferred_mechanism: true,
  })).default([]),
  constraint_flips: z.array(ConstraintFlipSchema.pick({ id: true, original: true, flipped: true, surprise: true })).default([]),
});
export type LeapSnapshot = z.output<typeof LeapSnapshotSchema>;

export const DesignSnapshotSchema = z.object({
  title: z.string(),
  one_liner: z.string(),
  modules: z.array(ModuleSchema.pick({ id: true, name: true, feature_ids: true })),
  user_flows: z.array(UserFlowSchema.pick({ name: true, goal: true })).default([]),
  data_model: z.array(DataEntitySchema.pick({ name: true })).default([]),
});
export type DesignSnapshot = z.output<typeof DesignSnapshotSchema>;
