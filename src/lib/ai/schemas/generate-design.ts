// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';

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

export const DesignProposalSchema = z.object({
  title: z.string(),
  one_liner: z.string(),
  vision: z.string(),
  design_principles: z.array(z.string()).min(2),
  information_architecture: z.array(SectionSchema).min(2),
  modules: z.array(ModuleSchema).min(2),
  user_flows: z.array(UserFlowSchema).min(1),
  key_interactions: z.array(SectionSchema).min(1),
  data_model: z.array(DataEntitySchema).min(1),
  tech_skeleton: z.array(SectionSchema).min(1),
  metrics: z.array(z.object({
    name: z.string(),
    definition: z.string(),
    target: z.string(),
  })),
  risks: z.array(z.object({
    risk: z.string(),
    mitigation: z.string(),
  })),
  milestones: z.array(MilestoneSchema).min(1),
  open_questions: z.array(z.string()),
});
export type DesignProposal = z.infer<typeof DesignProposalSchema>;
