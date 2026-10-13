import { z } from 'zod';
import { aiRoute, ModelOverrideSchema } from '@/lib/ai/route';
import { deriveFollowUps } from '@/lib/ai/tasks/derive-follow-ups';
import { NodeKindSchema } from '@/lib/model/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  nodeKind: NodeKindSchema,
  content: z.unknown(),
  model: ModelOverrideSchema,
});

export const POST = aiRoute({
  name: 'derive-follow-ups',
  body: Body,
  handle: (body, opts) => deriveFollowUps({ nodeKind: body.nodeKind, content: body.content }, opts),
});
