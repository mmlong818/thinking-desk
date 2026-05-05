import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeStakeholders } from '@/lib/ai/tasks/analyze-stakeholders';
import { PersonaSchema, JobSchema } from '@/lib/ai/tasks/analyze-users';
import { findProjectBySlug, getNode, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/tasks/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/tasks/analyze-users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
      // Fallbacks from DB if client didn't send everything.
      if (!brief) {
        const briefRow = await getNode<BriefNodeRow>(project.id, 'brief');
        if (briefRow?.content) {
          brief = {
            highlights: briefRow.content.highlights,
            fields: briefRow.content.fields,
            follow_ups: briefRow.content.follow_ups,
            completeness: briefRow.completeness,
          };
          rawText = rawText ?? briefRow.content.raw_text;
          answers = answers ?? briefRow.content.answers;
        }
      }
      if (personas.length === 0 || lockedJobs.length === 0) {
        const usersRow = await getNode<UsersNodeRow>(project.id, 'users');
        if (usersRow?.content) {
          const all = [
            ...usersRow.content.personas,
            ...(usersRow.content.extraPersonas ?? []),
          ];
          const pLocked = usersRow.content.personaLocked ?? {};
          if (personas.length === 0) {
            personas = all.filter((p) => pLocked[p.id]);
          }
          if (lockedJobs.length === 0) {
            const jLocked = usersRow.content.jobLocked ?? {};
            const allJobs = [
              ...usersRow.content.jobs.functional,
              ...usersRow.content.jobs.emotional,
              ...usersRow.content.jobs.social,
            ];
            lockedJobs = allJobs.filter((j) => jLocked[j.id]);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[analyze-stakeholders] DB unreachable:', e instanceof Error ? e.message : e);
  }

  if (!brief) {
    return NextResponse.json(
      { error: 'missing_brief', detail: '需要 Brief 上下文' },
      { status: 400 },
    );
  }

  try {
    const started = Date.now();
    const analysis = await analyzeStakeholders({
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
          'stake',
          { ...analysis, source_personas: personas.map((p) => p.id), source_jobs: lockedJobs.map((j) => j.id) },
          Math.round((analysis.stakeholders.filter((s) => s.required).length / 5) * 100),
        );
        const resolved = await providerFor('STAKE_MATRIX', body.model);
        await logAiExchange({
          projectId: project.id,
          nodeKind: 'stake',
          task: 'STAKE_MATRIX',
          kind: 'feed',
          prompt: JSON.stringify({
            personas: personas.length,
            lockedJobs: lockedJobs.length,
          }),
          response: analysis,
          provider: resolved.provider,
          model: resolved.model,
          latencyMs: latency,
        });
      } catch (e) {
        console.warn('[analyze-stakeholders] persistence failed:', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ ok: true, data: analysis, persisted: !!project });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[analyze-stakeholders] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
