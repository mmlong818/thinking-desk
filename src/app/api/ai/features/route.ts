import { NextResponse } from 'next/server';
import { z } from 'zod';
import { draftFeatures } from '@/lib/ai/tasks/draft-features';
import { PersonaSchema, JobSchema } from '@/lib/ai/tasks/analyze-users';
import {
  ScenarioDraftSchema,
  type ScenarioDeepAnalysis,
  type ScenarioDraft,
} from '@/lib/ai/tasks/analyze-scenarios';
import { findProjectBySlug, getNode, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/tasks/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/tasks/analyze-users';
import type { AlternativesAnalysis } from '@/lib/ai/tasks/analyze-alternatives';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  projectSlug: z.string().min(1),
  brief: z.unknown().optional(),
  rawText: z.string().optional(),
  answers: z.unknown().optional(),
  personas: z.array(PersonaSchema).optional(),
  lockedJobs: z.array(JobSchema).optional(),
  scenarios: z.array(ScenarioDraftSchema).optional(),
  design_insights: z.array(z.unknown()).optional(),
  pain_points: z.array(z.unknown()).optional(),
  differentiation_hypothesis: z.string().optional(),
  model: z.string().optional(),
});

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
interface ScenNodeRow {
  scenarios: ScenarioDraft[];
  picked_scenario_ids: string[];
  deep: ScenarioDeepAnalysis;
}

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }

  let brief: BriefExtraction | null = null;
  let rawText = body.rawText;
  let answers = Array.isArray(body.answers) ? (body.answers as ClarificationAnswer[]) : undefined;
  let personas: Persona[] = body.personas ?? [];
  let lockedJobs: Job[] = body.lockedJobs ?? [];
  let scenarios: ScenarioDraft[] = body.scenarios ?? [];
  let design_insights: ScenarioDeepAnalysis['design_insights'] =
    (body.design_insights as ScenarioDeepAnalysis['design_insights']) ?? [];
  let pain_points: ScenarioDeepAnalysis['pain_points'] =
    (body.pain_points as ScenarioDeepAnalysis['pain_points']) ?? [];
  let differentiation_hypothesis = body.differentiation_hypothesis;

  if (body.brief && typeof body.brief === 'object') brief = body.brief as BriefExtraction;

  let projectId: string | null = null;
  try {
    const project = await findProjectBySlug(body.projectSlug);
    if (project) {
      projectId = project.id;
      // Brief
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
      // Users
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
      // Scenarios
      if (scenarios.length === 0 || design_insights.length === 0) {
        const s = await getNode<ScenNodeRow>(project.id, 'scen');
        if (s?.content) {
          const pickedSet = new Set(s.content.picked_scenario_ids);
          scenarios = s.content.scenarios.filter((sc) => pickedSet.has(sc.id));
          if (design_insights.length === 0) design_insights = s.content.deep.design_insights;
          if (pain_points.length === 0) pain_points = s.content.deep.pain_points;
        }
      }
      // Alternatives → differentiation_hypothesis
      if (!differentiation_hypothesis) {
        const a = await getNode<AlternativesAnalysis>(project.id, 'alt');
        if (a?.content?.differentiation_hypothesis) {
          differentiation_hypothesis = a.content.differentiation_hypothesis;
        }
      }
    }
  } catch (e) {
    console.warn('[features] DB unreachable:', e instanceof Error ? e.message : e);
  }

  if (!brief) {
    return NextResponse.json({ error: 'missing_brief', detail: '需要 Brief 上下文' }, { status: 400 });
  }

  try {
    const started = Date.now();
    const result = await draftFeatures({
      brief,
      rawText,
      answers,
      personas,
      lockedJobs,
      scenarios,
      design_insights,
      pain_points,
      differentiation_hypothesis,
      override: body.model,
    });
    const latency = Date.now() - started;

    if (projectId) {
      try {
        await upsertNode(
          projectId, 'feat',
          { ...result, source_insight_count: design_insights.length },
          Math.min(100, 40 + result.features.length * 4),
        );
        const resolved = await providerFor('FEAT_DRAFT', body.model);
        await logAiExchange({
          projectId, nodeKind: 'feat', task: 'FEAT_DRAFT', kind: 'feed',
          prompt: JSON.stringify({
            insights: design_insights.length,
            jobs: lockedJobs.length,
            personas: personas.length,
          }),
          response: result,
          provider: resolved.provider, model: resolved.model,
          latencyMs: latency,
        });
      } catch (e) {
        console.warn('[features] persist failed:', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[features] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
