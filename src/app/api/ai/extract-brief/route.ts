import { NextResponse } from 'next/server';
import { z } from 'zod';
import { extractBrief } from '@/lib/ai/tasks/extract-brief';
import { findProjectBySlug, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  projectSlug: z.string().min(1),
  rawText: z.string().min(1).max(20000),
  answers: z
    .array(
      z.object({
        question: z.string(),
        answer: z.union([z.string(), z.array(z.string())]),
      }),
    )
    .optional(),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }

  // DB is optional in dev — if Postgres isn't reachable we still return the AI
  // result so the user sees something. Persistence happens on best-effort basis.
  let project: Awaited<ReturnType<typeof findProjectBySlug>> = null;
  try {
    project = await findProjectBySlug(body.projectSlug);
  } catch (e) {
    console.warn('[extract-brief] DB unreachable, skipping persistence:', e instanceof Error ? e.message : e);
  }

  try {
    const started = Date.now();
    const extraction = await extractBrief(body.rawText, body.answers, body.model);
    const latency = Date.now() - started;

    if (project) {
      try {
        await upsertNode(
          project.id,
          'brief',
          {
            raw_text: body.rawText,
            answers: body.answers ?? [],
            highlights: extraction.highlights,
            fields: extraction.fields,
            follow_ups: extraction.follow_ups,
          },
          extraction.completeness,
        );
        const resolved = await providerFor('BRIEF_EXTRACT');
        await logAiExchange({
          projectId: project.id,
          nodeKind: 'brief',
          task: 'BRIEF_EXTRACT',
          kind: 'feed',
          prompt: body.rawText,
          response: extraction,
          provider: resolved.provider,
          model: resolved.model,
          latencyMs: latency,
        });
      } catch (e) {
        console.warn('[extract-brief] persistence failed:', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ ok: true, data: extraction, persisted: !!project });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    // Stack 仅日志，不返回客户端（避免泄漏内部路径 / 库版本）
    console.error('[extract-brief] failed:', message, stack);
    return NextResponse.json(
      { error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown error' } : {}) },
      { status: 502 },
    );
  }
}
