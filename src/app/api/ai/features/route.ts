import { z } from 'zod';
import { aiRoute, BriefContextFields, requireBrief } from '@/lib/ai/route';
import { JobSchema, PersonaSchema } from '@/lib/ai/schemas/analyze-users';
import { InsightDigestSchema, PainDigestSchema, ScenarioDigestSchema } from '@/lib/ai/schemas/snapshots';
import { draftFeatures } from '@/lib/ai/tasks/draft-features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  ...BriefContextFields,
  personas: z.array(PersonaSchema).optional(),
  lockedJobs: z.array(JobSchema).optional(),
  scenarios: z.array(ScenarioDigestSchema).optional(),
  design_insights: z.array(InsightDigestSchema).optional(),
  pain_points: z.array(PainDigestSchema).optional(),
  differentiation_hypothesis: z.string().optional(),
});

export const POST = aiRoute({
  name: 'features',
  body: Body,
  timeoutMs: 290_000,
  handle: (body, opts) =>
    draftFeatures(
      {
        brief: requireBrief(body.brief),
        rawText: body.rawText,
        answers: body.answers,
        personas: body.personas ?? [],
        lockedJobs: body.lockedJobs ?? [],
        scenarios: body.scenarios ?? [],
        design_insights: body.design_insights ?? [],
        pain_points: body.pain_points ?? [],
        differentiation_hypothesis: body.differentiation_hypothesis,
        feedback: body.feedback,
      },
      opts,
    ),
});
