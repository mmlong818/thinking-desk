import { z } from 'zod';
import { aiRoute, ModelOverrideSchema, RouteError } from '@/lib/ai/route';
import { RegenerationFeedbackSchema } from '@/lib/model/feedback';
import { DesignSnapshotSchema } from '@/lib/ai/schemas/snapshots';
import { splitSubfeatures } from '@/lib/ai/tasks/split-subfeatures';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  projectSlug: z.string().min(1),
  design: DesignSnapshotSchema.optional(),
  model: ModelOverrideSchema,
  feedback: RegenerationFeedbackSchema.optional(),
});

export const POST = aiRoute({
  name: 'split-subfeatures',
  body: Body,
  timeoutMs: 290_000,
  // Long call (70-100 s): live progress and cancel for clients that ask for NDJSON.
  stream: true,
  handle(body, opts) {
    if (!body.design) throw new RouteError(400, 'missing_design', '需要先在 08 生成设计案');
    return splitSubfeatures({ design: body.design, feedback: body.feedback }, opts);
  },
});
