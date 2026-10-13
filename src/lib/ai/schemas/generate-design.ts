// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';
import { StanceField } from './stance';

export const SectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
});
export type DesignSection = z.infer<typeof SectionSchema>;

export const FlowStepSchema = z.object({
  step: z.number().int().min(1),
  actor: z.string(),
  action: z.string(),
  system_response: z.string(),
});
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const UserFlowSchema = z.object({
  id: z.string(),
  name: z.string(),
  goal: z.string(),
  precondition: z.string(),
  steps: z.array(FlowStepSchema).min(2),
  success_criteria: z.string(),
  failure_handling: z.string(),
});
export type UserFlow = z.infer<typeof UserFlowSchema>;

export const ModuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  responsibility: z.string(),
  feature_ids: z.array(z.string()),
  key_screens: z.array(z.string()),
  depends_on: z.array(z.string()).default([]),
});
export type DesignModule = z.infer<typeof ModuleSchema>;

export const DataEntitySchema = z.object({
  name: z.string(),
  description: z.string(),
  fields: z.array(z.object({
    name: z.string(),
    type: z.string(),
    note: z.string().default(''),
  })),
});
export type DataEntity = z.infer<typeof DataEntitySchema>;

export const MilestoneSchema = z.object({
  phase: z.string(),
  goal: z.string(),
  deliverables: z.array(z.string()),
  duration: z.string(),
});
export type Milestone = z.infer<typeof MilestoneSchema>;

// The design as the AI outputs it: every part carries its own `stance` (the AI's verdict on that
// entry). The shapes above stay stance-free: item bodies and upstream snapshots reuse them.
const StancedSection = SectionSchema.extend({ stance: StanceField });

/** An open question; a bare string (the pre-stance shape) is still accepted, without a verdict. */
export const OpenQuestionSchema = z.preprocess(
  (v) => (typeof v === 'string' ? { question: v } : v),
  z.object({ question: z.string(), stance: StanceField }),
);

export const DesignProposalSchema = z.object({
  title: z.string(),
  one_liner: z.string(),
  vision: z.string(),
  overview_stance: StanceField,
  design_principles: z.array(z.string()).min(2),
  principles_stance: StanceField,
  information_architecture: z.array(StancedSection).min(2),
  modules: z.array(ModuleSchema.extend({ stance: StanceField })).min(2),
  user_flows: z.array(UserFlowSchema.extend({ stance: StanceField })).min(1),
  key_interactions: z.array(StancedSection).min(1),
  data_model: z.array(DataEntitySchema.extend({ stance: StanceField })).min(1),
  tech_skeleton: z.array(StancedSection).min(1),
  metrics: z.array(z.object({
    name: z.string(),
    definition: z.string(),
    target: z.string(),
    stance: StanceField,
  })),
  risks: z.array(z.object({
    risk: z.string(),
    mitigation: z.string(),
    stance: StanceField,
  })),
  milestones: z.array(MilestoneSchema.extend({ stance: StanceField })).min(1),
  open_questions: z.array(OpenQuestionSchema),
});
export type DesignProposal = z.infer<typeof DesignProposalSchema>;
