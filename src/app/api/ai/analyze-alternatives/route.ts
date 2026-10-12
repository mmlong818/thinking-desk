import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeAlternatives } from '@/lib/ai/tasks/analyze-alternatives';
import { PersonaSchema, JobSchema } from '@/lib/ai/schemas/analyze-users';
import { findProjectBySlug, getNode, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/schemas/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/schemas/analyze-users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 180;

const Body = z.object({
  projectSlug: z.string().min(1),
  brief: z.unknown().optional(),
  rawText: z.string().optional(),
  answers: z.unknown().optional(),
  personas: z.array(PersonaSchema).optional(),
  lockedJobs: z.array(JobSchema).optional(),
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

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }

  let brief: BriefExtraction | null = null;
  let rawText: string | undefined = body.rawText;
  let answers: ClarificationAnswer[] | undefined = Array.isArray(body.answers)
    ? (body.answers as ClarificationAnswer[])
    : undefined;
  let personas: Persona[] = body.personas ?? [];
  let lockedJobs: Job[] = body.lockedJobs ?? [];
  if (body.brief && typeof body.brief === 'object') brief = body.brief as BriefExtraction;

  let project: Awaited<ReturnType<typeof findProjectBySlug>> = null;
  try {
    project = await findProjectBySlug(body.projectSlug);
    if (project) {
      if (!brief) {
        const row = await getNode<BriefNodeRow>(project.id, 'brief');
        if (row?.content) {
          brief = {
            highlights: row.content.highlights,
            fields: row.content.fields,
            follow_ups: row.content.follow_ups,
            completeness: row.completeness,
          };
          rawText = rawText ?? row.content.raw_text;
          answers = answers ?? row.content.answers;
        }
      }
      if (personas.length === 0 || lockedJobs.length === 0) {
        const users = await getNode<UsersNodeRow>(project.id, 'users');
        if (users?.content) {
          const allPersonas = [
            ...users.content.personas,
            ...(users.content.extraPersonas ?? []),
          ];
          const pLocked = users.content.personaLocked ?? {};
          if (personas.length === 0) personas = allPersonas.filter((p) => pLocked[p.id]);
          if (lockedJobs.length === 0) {
            const jLocked = users.content.jobLocked ?? {};
            const allJobs = [
              ...users.content.jobs.functional,
              ...users.content.jobs.emotional,
              ...users.content.jobs.social,
            ];
            lockedJobs = allJobs.filter((j) => jLocked[j.id]);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[analyze-alternatives] DB unreachable:', e instanceof Error ? e.message : e);
  }

  if (!brief) {
    return NextResponse.json(
      { error: 'missing_brief', detail: '需要 Brief 上下文' },
      { status: 400 },
    );
  }

  try {
    const started = Date.now();
    const analysis = await analyzeAlternatives({
      brief,
      rawText,
      answers,
      personas,
      lockedJobs,
      override: body.model,
    });
    const latency = Date.now() - started;

    if (project) {
      try {
        await upsertNode(
          project.id,
          'alt',
          { ...analysis, source_personas: personas.map((p) => p.id), source_jobs: lockedJobs.map((j) => j.id) },
          Math.min(100, analysis.alternatives.length * 8 + analysis.strategic_profiles.length * 8),
        );
        const resolved = await providerFor('ALT_SCAN', body.model);
        await logAiExchange({
          projectId: project.id,
          nodeKind: 'alt',
          task: 'ALT_SCAN',
          kind: 'feed',
          prompt: JSON.stringify({ personas: personas.length, lockedJobs: lockedJobs.length }),
          response: analysis,
          provider: resolved.provider,
          model: resolved.model,
          latencyMs: latency,
        });
      } catch (e) {
        console.warn('[analyze-alternatives] persist failed:', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ ok: true, data: analysis, persisted: !!project });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[analyze-alternatives] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
