import { z } from 'zod';
import { aiRoute, ModelOverrideSchema, requireBrief, RouteError } from '@/lib/ai/route';
import { PillarSchema } from '@/lib/ai/schemas/draft-features';
import { BriefSnapshotSchema, FeatureDigestSchema } from '@/lib/ai/schemas/snapshots';
import { generateDesignProposal } from '@/lib/ai/tasks/generate-design';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  projectSlug: z.string().min(1),
  brief: BriefSnapshotSchema.optional(),
  features: z.array(FeatureDigestSchema).optional(),
  pillars: z.array(PillarSchema).optional(),
  model: ModelOverrideSchema,
});

export const POST = aiRoute({
  name: 'generate-design',
  body: Body,
  timeoutMs: 290_000,
  handle(body, opts) {
    const brief = requireBrief(body.brief);
    const features = body.features ?? [];
    if (features.length === 0) {
      throw new RouteError(400, 'missing_features', '需要先完成功能列表 / 跃迁节点');
    }
    return generateDesignProposal({ brief, features, pillars: body.pillars ?? [] }, opts);
  },
});
