import { NextResponse } from 'next/server';
import { z } from 'zod';
import { DimensionsResultSchema, ScenarioDraftSchema } from '@/lib/ai/schemas/analyze-scenarios';
import { combineScenarios, deepAnalyzeScenarios, exhaustScenarioDimensions } from '@/lib/ai/tasks/analyze-scenarios';
import { PersonaSchema, JobSchema } from '@/lib/ai/schemas/analyze-users';
import { findProjectBySlug, getNode, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/schemas/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/schemas/analyze-users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const CommonCtx = {
  projectSlug: z.string().min(1),
  brief: z.unknown().optional(),
  rawText: z.string().optional(),
  answers: z.unknown().optional(),
  personas: z.array(PersonaSchema).optional(),
  lockedJobs: z.array(JobSchema).optional(),
  model: z.string().optional(),
};

const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('exhaust'), ...CommonCtx }),
  z.object({
    action: z.literal('combine'),
    ...CommonCtx,
    dimensions: DimensionsResultSchema,
    selectedElementIds: z.array(z.string()).min(3),
  }),
  z.object({
    action: z.literal('deep'),
    ...CommonCtx,
    scenarios: z.array(ScenarioDraftSchema).min(1),
    pickedScenarioIds: z.array(z.string()).min(1).max(5),
  }),
]);

interface BriefNodeRow {
  raw_text?: string;
  answers?: ClarificationAnswer[];
  highlights: BriefExtraction['highlights'];
  fields: BriefExtraction['fields'];
  follow_ups: BriefExtraction['follow_ups'];
}
interface UsersNodeRow extends UsersAnalysis {
  extraPersonas?: Persona[];
  personaLocked?: Record<string, boolean>;
  jobLocked?: Record<string, boolean>;
}

async function resolveContext(body: z.infer<typeof Body>): Promise<{
  brief: BriefExtraction | null;
  rawText: string | undefined;
  answers: ClarificationAnswer[] | undefined;
  personas: Persona[];
  lockedJobs: Job[];
  projectId: string | null;
}> {
  let brief: BriefExtraction | null = null;
  let rawText = body.rawText;
  let answers = Array.isArray(body.answers) ? (body.answers as ClarificationAnswer[]) : undefined;
  let personas: Persona[] = body.personas ?? [];
  let lockedJobs: Job[] = body.lockedJobs ?? [];
  if (body.brief && typeof body.brief === 'object') brief = body.brief as BriefExtraction;

  let projectId: string | null = null;
  try {
    const project = await findProjectBySlug(body.projectSlug);
    if (project) {
      projectId = project.id;
      if (!brief) {
        const r = await getNode<BriefNodeRow>(project.id, 'brief');
        if (r?.content) {
          brief = {
            highlights: r.content.highlights,
            fields: r.content.fields,
            follow_ups: r.content.follow_ups,
            completeness: r.completeness,
          };
          rawText = rawText ?? r.content.raw_text;
          answers = answers ?? r.content.answers;
        }
      }
      if (personas.length === 0 || lockedJobs.length === 0) {
        const u = await getNode<UsersNodeRow>(project.id, 'users');
        if (u?.content) {
          const all = [...u.content.personas, ...(u.content.extraPersonas ?? [])];
          const pLocked = u.content.personaLocked ?? {};
          if (personas.length === 0) personas = all.filter((p) => pLocked[p.id]);
          if (lockedJobs.length === 0) {
            const jLocked = u.content.jobLocked ?? {};
            const allJobs = [
              ...u.content.jobs.functional,
              ...u.content.jobs.emotional,
              ...u.content.jobs.social,
            ];
            lockedJobs = allJobs.filter((j) => jLocked[j.id]);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[scenarios] DB unreachable:', e instanceof Error ? e.message : e);
  }
  return { brief, rawText, answers, personas, lockedJobs, projectId };
}

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }

  const { brief, rawText, answers, personas, lockedJobs, projectId } = await resolveContext(body);
  if (!brief) {
    return NextResponse.json({ error: 'missing_brief', detail: '需要 Brief 上下文' }, { status: 400 });
  }

  const started = Date.now();
  try {
    const resolved = await providerFor('SCEN_FEED', body.model);

    if (body.action === 'exhaust') {
      const result = await exhaustScenarioDimensions({
        brief, rawText, answers, personas, lockedJobs, override: body.model,
      });
      if (projectId) {
        try {
          await logAiExchange({
            projectId, nodeKind: 'scen', task: 'SCEN_FEED', kind: 'feed',
            prompt: JSON.stringify({ action: 'exhaust', personas: personas.length, jobs: lockedJobs.length }),
            response: result,
            provider: resolved.provider, model: resolved.model,
            latencyMs: Date.now() - started,
          });
        } catch {}
      }
      return NextResponse.json({ ok: true, data: result });
    }

    if (body.action === 'combine') {
      const result = await combineScenarios({
        brief, rawText, answers, personas, lockedJobs,
        dimensions: body.dimensions,
        selectedElementIds: body.selectedElementIds,
        override: body.model,
      });
      if (projectId) {
        try {
          await logAiExchange({
            projectId, nodeKind: 'scen', task: 'SCEN_FEED', kind: 'feed',
            prompt: JSON.stringify({ action: 'combine', selected: body.selectedElementIds.length }),
            response: result,
            provider: resolved.provider, model: resolved.model,
            latencyMs: Date.now() - started,
          });
        } catch {}
      }
      return NextResponse.json({ ok: true, data: result });
    }

    // action === 'deep'
    const result = await deepAnalyzeScenarios({
      brief, rawText, answers, personas, lockedJobs,
      scenarios: body.scenarios,
      pickedScenarioIds: body.pickedScenarioIds,
      override: body.model,
    });

    if (projectId) {
      try {
        await upsertNode(
          projectId, 'scen',
          {
            scenarios: body.scenarios,
            picked_scenario_ids: body.pickedScenarioIds,
            deep: result,
          },
          Math.min(100, 50 + result.design_insights.length * 6),
        );
        await logAiExchange({
          projectId, nodeKind: 'scen', task: 'SCEN_PAIN', kind: 'feed',
          prompt: JSON.stringify({ action: 'deep', picked: body.pickedScenarioIds.length }),
          response: result,
          provider: resolved.provider, model: resolved.model,
          latencyMs: Date.now() - started,
        });
      } catch {}
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[scenarios] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
