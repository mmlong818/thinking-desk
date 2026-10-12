import { z } from 'zod';
import { aiRoute, BriefContextFields, requireBrief } from '@/lib/ai/route';
import { JobSchema, PersonaSchema } from '@/lib/ai/schemas/analyze-users';
import { analyzeAlternatives } from '@/lib/ai/tasks/analyze-alternatives';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const Body = z.object({
  ...BriefContextFields,
  personas: z.array(PersonaSchema).optional(),
  lockedJobs: z.array(JobSchema).optional(),
});

export const POST = aiRoute({
  name: 'analyze-alternatives',
  body: Body,
  timeoutMs: 170_000,
  handle: (body, opts) =>
    analyzeAlternatives(
      {
        brief: requireBrief(body.brief),
        rawText: body.rawText,
        answers: body.answers,
        personas: body.personas ?? [],
        lockedJobs: body.lockedJobs ?? [],
      },
      opts,
    ),
});
