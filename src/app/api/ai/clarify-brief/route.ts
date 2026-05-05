import { NextResponse } from 'next/server';
import { z } from 'zod';
import { clarifyBrief } from '@/lib/ai/tasks/clarify-brief';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  rawText: z.string().min(1).max(20000),
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
    const result = await clarifyBrief(body.rawText, body.model);
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stack = e instanceof Error ? e.stack : undefined;
    console.error('[clarify-brief] failed:', message, stack);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown error' } : {}) }, { status: 502 });
  }
}
