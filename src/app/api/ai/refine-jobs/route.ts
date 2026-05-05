import { NextResponse } from 'next/server';
import { z } from 'zod';
import { PersonaSchema, JobSchema, refineJobs } from '@/lib/ai/tasks/analyze-users';
import { findProjectBySlug, getNode, logAiExchange } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/tasks/extract-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  projectSlug: z.string().min(1),
  brief: z.unknown().optional(),
  rawText: z.string().optional(),
  answers: z.unknown().optional(),
  selectedPersonas: z.array(PersonaSchema).min(1),
  existingJobs: z.object({
    functional: z.array(JobSchema),
    emotional: z.array(JobSchema),
    social: z.array(JobSchema),
  }),
  userLockedJobIds: z.array(z.string()).default([]),
  model: z.string().optional(),
});

interface BriefNodeRow {
  raw_text?: string;
  answers?: ClarificationAnswer[];
  highlights: BriefExtraction['highlights'];
  fields: BriefExtraction['fields'];
  follow_ups: BriefExtraction['follow_ups'];
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
  if (body.brief && typeof body.brief === 'object') brief = body.brief as BriefExtraction;

  let project: Awaited<ReturnType<typeof findProjectBySlug>> = null;
  try {
    project = await findProjectBySlug(body.projectSlug);
    if (!brief && project) {
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
  } catch {
    // DB optional
  }

  if (!brief) {
    return NextResponse.json({ error: 'missing_brief', detail: '需要 Brief 上下文' }, { status: 400 });
  }

  try {
    const started = Date.now();
    const refined = await refineJobs({
      brief,
      rawText,
      answers,
      selectedPersonas: body.selectedPersonas,
      existingJobs: body.existingJobs,
      userLockedJobIds: body.userLockedJobIds,
      override: body.model,
    });
    const latency = Date.now() - started;

    if (project) {
      try {
        const resolved = await providerFor('USERS_JTBD', body.model);
        await logAiExchange({
          projectId: project.id,
          nodeKind: 'users',
          task: 'USERS_JTBD',
          kind: 'check',
          prompt: JSON.stringify({
            selectedPersonas: body.selectedPersonas.map((p) => p.id),
            existingJobsCount:
              body.existingJobs.functional.length +
              body.existingJobs.emotional.length +
              body.existingJobs.social.length,
          }),
          response: refined,
          provider: resolved.provider,
          model: resolved.model,
          latencyMs: latency,
        });
      } catch {
        // best-effort logging
      }
    }

    return NextResponse.json({ ok: true, data: refined });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[refine-jobs] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
