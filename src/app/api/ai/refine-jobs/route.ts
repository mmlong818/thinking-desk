import { z } from 'zod';
import { aiRoute, BriefContextFields, requireBrief } from '@/lib/ai/route';
import { JobSchema, PersonaSchema } from '@/lib/ai/schemas/analyze-users';
import { refineJobs } from '@/lib/ai/tasks/analyze-users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  ...BriefContextFields,
  selectedPersonas: z.array(PersonaSchema).min(1),
  existingJobs: z.object({
    functional: z.array(JobSchema),
    emotional: z.array(JobSchema),
    social: z.array(JobSchema),
  }),
});

/** Jobs the person accepted or edited must survive the refinement unchanged (feedback.keep). */
const keptJobIds = (body: z.output<typeof Body>): string[] =>
  (body.feedback?.keep ?? []).filter((k) => k.type === 'job').map((k) => k.id);

export const POST = aiRoute({
  name: 'refine-jobs',
  body: Body,
  handle: (body, opts) =>
    refineJobs(
      {
        brief: requireBrief(body.brief),
        rawText: body.rawText,
        answers: body.answers,
        selectedPersonas: body.selectedPersonas,
        existingJobs: body.existingJobs,
        userLockedJobIds: keptJobIds(body),
        feedback: body.feedback,
      },
      opts,
    ),
});
