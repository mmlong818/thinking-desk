import { z } from 'zod';
import { aiRoute, ModelOverrideSchema } from '@/lib/ai/route';
import { clarifyBrief } from '@/lib/ai/tasks/clarify-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  rawText: z.string().min(1).max(20000),
  model: ModelOverrideSchema,
});

export const POST = aiRoute({
  name: 'clarify-brief',
  body: Body,
  handle: (body, opts) => clarifyBrief({ rawText: body.rawText }, opts),
});
