import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeUsers } from '@/lib/ai/tasks/analyze-users';
import { findProjectBySlug, getNode, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/schemas/extract-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  projectSlug: z.string().min(1),
  // Callers MAY pass a brief snapshot, or let us load it from DB.
  brief: z.unknown().optional(),
  rawText: z.string().optional(),
  answers: z.unknown().optional(),
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

  // Resolve the Brief input: prefer caller payload, fall back to DB.
  let brief: BriefExtraction | null = null;
  let rawText: string | undefined = body.rawText;
  let answers: ClarificationAnswer[] | undefined = Array.isArray(body.answers)
    ? (body.answers as ClarificationAnswer[])
    : undefined;

  if (body.brief && typeof body.brief === 'object') {
    brief = body.brief as BriefExtraction;
  }

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
  } catch (e) {
    console.warn('[analyze-users] DB unreachable:', e instanceof Error ? e.message : e);
  }

  if (!brief) {
    return NextResponse.json(
      { error: 'missing_brief', detail: '需要先完成 Brief 节点或在请求体里传入 brief 快照' },
      { status: 400 },
    );
  }

  try {
    const started = Date.now();
    const analysis = await analyzeUsers({ brief, rawText, answers, override: body.model });
    const latency = Date.now() - started;

    if (project) {
      try {
        const avgReach =
          [...analysis.jobs.functional, ...analysis.jobs.emotional, ...analysis.jobs.social]
            .reduce((a, j) => a + j.reach, 0) / Math.max(
            analysis.jobs.functional.length +
              analysis.jobs.emotional.length +
              analysis.jobs.social.length,
            1,
          );
        await upsertNode(
          project.id,
          'users',
          { ...analysis, source_brief_snapshot: brief },
          Math.min(100, Math.round(avgReach * 10)),
        );
        const resolved = await providerFor('USERS_JTBD');
        await logAiExchange({
          projectId: project.id,
          nodeKind: 'users',
          task: 'USERS_JTBD',
          kind: 'feed',
          prompt: JSON.stringify({ brief, answers }),
          response: analysis,
          provider: resolved.provider,
          model: resolved.model,
          latencyMs: latency,
        });
      } catch (e) {
        console.warn('[analyze-users] persistence failed:', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ ok: true, data: analysis, persisted: !!project });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[analyze-users] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown error' } : {}) }, { status: 502 });
  }
}
