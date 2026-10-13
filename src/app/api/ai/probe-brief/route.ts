import { z } from 'zod';
import { aiRoute, ModelOverrideSchema } from '@/lib/ai/route';
import { ProbeTurnSchema } from '@/lib/ai/schemas/probe-brief';
import { probeBrief } from '@/lib/ai/tasks/probe-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  rawText: z.string().min(1).max(20000),
  history: z.array(ProbeTurnSchema).default([]),
  model: ModelOverrideSchema,
});

export const POST = aiRoute({
  name: 'probe-brief',
  body: Body,
  handle: (body, opts) => probeBrief({ rawText: body.rawText, history: body.history }, opts),
});
