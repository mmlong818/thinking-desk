import { z } from 'zod';
import { aiRoute, ModelOverrideSchema } from '@/lib/ai/route';
import { ClarificationAnswerSchema } from '@/lib/ai/schemas/extract-brief';
import { extractBrief } from '@/lib/ai/tasks/extract-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  projectSlug: z.string().min(1),
  rawText: z.string().min(1).max(20000),
  answers: z.array(ClarificationAnswerSchema).optional(),
  model: ModelOverrideSchema,
});

export const POST = aiRoute({
  name: 'extract-brief',
  body: Body,
  handle: (body, opts) => extractBrief({ rawText: body.rawText, answers: body.answers }, opts),
});
