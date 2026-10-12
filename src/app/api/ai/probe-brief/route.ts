import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ProbeTurnSchema } from '@/lib/ai/schemas/probe-brief';
import { probeBrief } from '@/lib/ai/tasks/probe-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  rawText: z.string().min(1).max(20000),
  history: z.array(ProbeTurnSchema).default([]),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }

  try {
    const result = await probeBrief({
      rawText: body.rawText,
      history: body.history,
      override: body.model,
    });
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[probe-brief] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
