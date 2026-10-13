import { z } from 'zod';
import { aiRoute, BriefContextFields, requireBrief, RouteError } from '@/lib/ai/route';
import { JobSchema, PersonaSchema } from '@/lib/ai/schemas/analyze-users';
import { LEAP_CATEGORIES } from '@/lib/ai/schemas/creative-leap';
import { FeatureDigestSchema } from '@/lib/ai/schemas/snapshots';
import { analyzeCreativeLeap, generateMoreLeapItems } from '@/lib/ai/tasks/creative-leap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  action: z.enum(['initial', 'more']).default('initial'),
  ...BriefContextFields,
  personas: z.array(PersonaSchema).optional(),
  lockedJobs: z.array(JobSchema).optional(),
  features: z.array(FeatureDigestSchema).optional(),
  differentiation_hypothesis: z.string().optional(),
  alt_threats: z.array(z.string()).optional(),
  // 增量生成参数（采纳 / 否决通过 feedback 传入）
  category: z.enum(LEAP_CATEGORIES).optional(),
  existing: z.array(z.unknown()).optional(),
});

export const POST = aiRoute({
  name: 'creative-leap',
  body: Body,
  timeoutMs: 290_000,
  // Both actions stream: "initial" runs 70-100 s, "more" is shorter but just as cancellable.
  stream: true,
  handle(body, opts) {
    const ctx = {
      brief: requireBrief(body.brief),
      rawText: body.rawText,
      answers: body.answers,
      personas: body.personas ?? [],
      lockedJobs: body.lockedJobs ?? [],
      features: body.features ?? [],
      differentiation_hypothesis: body.differentiation_hypothesis,
      alt_threats: body.alt_threats,
      feedback: body.feedback,
    };
    if (body.action === 'initial') return analyzeCreativeLeap(ctx, opts);
    if (!body.category) throw new RouteError(400, 'missing_category');
    return generateMoreLeapItems(
      { ...ctx, category: body.category, existing: body.existing ?? [] },
      opts,
    );
  },
});
