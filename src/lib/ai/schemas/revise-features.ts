// Client-safe task contract: Zod schemas, types and UI constants only. Never import the router,
// providers or tasks here (enforced by client-safety.test.ts).
import { z } from 'zod';
import { FeatureSchema, NotDoingSchema, PillarSchema } from './draft-features';

export const RevisionNoteSchema = z.object({
  action: z.enum(['added', 'modified', 'removed', 'kept']),
  /** 新 / 修改后 feature 的 id（kept / modified / added 有效） */
  feature_id: z.string().optional(),
  /** 被替换 / 被删除的原 feature id（modified / removed 有效） */
  original_feature_id: z.string().optional(),
  /** 名字快照 · 便于展示 diff */
  name_before: z.string().optional(),
  name_after: z.string().optional(),
  /** 这次变更的理由 */
  reason: z.string(),
  /** 来源跃迁 id（如果这条变更源自某条跃迁） */
  source_leap_ids: z.array(z.string()).default([]),
});
export type RevisionNote = z.infer<typeof RevisionNoteSchema>;

export const FeatureRevisionSchema = z.object({
  revised_features: z.array(FeatureSchema).min(3),
  revised_pillars: z.array(PillarSchema).min(2).max(6),
  /** 修订理由清单 */
  revisions: z.array(RevisionNoteSchema).min(1),
  /** 修订后新的"不做清单" */
  revised_not_doing: z.array(NotDoingSchema),
  /** 新的差异化回响 */
  differentiation_echo: z.string(),
  /** 一段话讲清"这次修订改了什么，为什么" */
  summary: z.string(),
  critiques: z
    .array(
      z.object({
        kind: z.enum(['check', 'critique', 'ask']),
        title: z.string(),
        body: z.string(),
      }),
    )
    .max(5),
});
export type FeatureRevision = z.infer<typeof FeatureRevisionSchema>;
