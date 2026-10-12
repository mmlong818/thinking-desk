import { z } from 'zod';
import { aiRoute, BriefContextFields, requireBrief } from '@/lib/ai/route';
import { DimensionsSnapshotSchema, ScenarioDigestSchema } from '@/lib/ai/schemas/snapshots';
import { JobSchema, PersonaSchema } from '@/lib/ai/schemas/analyze-users';
import { combineScenarios, deepAnalyzeScenarios, exhaustScenarioDimensions } from '@/lib/ai/tasks/analyze-scenarios';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CommonCtx = {
  ...BriefContextFields,
  personas: z.array(PersonaSchema).optional(),
  lockedJobs: z.array(JobSchema).optional(),
};

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('exhaust'), ...CommonCtx }),
  z.object({
    action: z.literal('combine'),
    ...CommonCtx,
    dimensions: DimensionsSnapshotSchema,
    selectedElementIds: z.array(z.string()).min(3),
  }),
  z.object({
    action: z.literal('deep'),
    ...CommonCtx,
    scenarios: z.array(ScenarioDigestSchema).min(1),
    pickedScenarioIds: z.array(z.string()).min(1).max(5),
  }),
]);

export const POST = aiRoute({
  name: 'scenarios',
  body: Body,
  timeoutMs: 290_000,
  handle(body, opts) {
    const ctx = {
      brief: requireBrief(body.brief),
      rawText: body.rawText,
      answers: body.answers,
      personas: body.personas ?? [],
      lockedJobs: body.lockedJobs ?? [],
      feedback: body.feedback,
    };
    if (body.action === 'exhaust') return exhaustScenarioDimensions(ctx, opts);
    if (body.action === 'combine') {
      return combineScenarios({ ...ctx, dimensions: body.dimensions, selectedElementIds: body.selectedElementIds }, opts);
    }
    return deepAnalyzeScenarios({ ...ctx, scenarios: body.scenarios, pickedScenarioIds: body.pickedScenarioIds }, opts);
  },
});
