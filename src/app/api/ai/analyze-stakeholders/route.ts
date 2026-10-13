import { z } from 'zod';
import { aiRoute, BriefContextFields, requireBrief } from '@/lib/ai/route';
import { JobSchema, PersonaSchema } from '@/lib/ai/schemas/analyze-users';
import { analyzeStakeholders } from '@/lib/ai/tasks/analyze-stakeholders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  ...BriefContextFields,
  personas: z.array(PersonaSchema).optional(),
  lockedJobs: z.array(JobSchema).optional(),
});

export const POST = aiRoute({
  name: 'analyze-stakeholders',
  body: Body,
  handle: (body, opts) =>
    analyzeStakeholders(
      {
        brief: requireBrief(body.brief),
        rawText: body.rawText,
        answers: body.answers,
        personas: body.personas ?? [],
        lockedJobs: body.lockedJobs ?? [],
        feedback: body.feedback,
      },
      opts,
    ),
});
