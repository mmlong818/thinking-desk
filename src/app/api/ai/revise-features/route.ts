import { z } from 'zod';
import { aiRoute, BriefContextFields, RouteError } from '@/lib/ai/route';
import { FeatureListSnapshotSchema, LeapSnapshotSchema } from '@/lib/ai/schemas/snapshots';
import { reviseFeaturesWithLeaps } from '@/lib/ai/tasks/revise-features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  ...BriefContextFields,
  original: FeatureListSnapshotSchema.optional(),
  leaps: LeapSnapshotSchema.optional(),
  selectedLeapIds: z.array(z.string()).min(1),
});

export const POST = aiRoute({
  name: 'revise-features',
  body: Body,
  timeoutMs: 290_000,
  handle(body, opts) {
    if (!body.brief) throw new RouteError(400, 'missing_brief');
    if (!body.original) throw new RouteError(400, 'missing_features', '需要先完成功能列表');
    if (!body.leaps) throw new RouteError(400, 'missing_leaps', '需要先完成创造性跃迁');
    return reviseFeaturesWithLeaps(
      {
        brief: body.brief,
        rawText: body.rawText,
        answers: body.answers,
        original: body.original,
        leaps: body.leaps,
        selectedLeapIds: body.selectedLeapIds,
      },
      opts,
    );
  },
});
