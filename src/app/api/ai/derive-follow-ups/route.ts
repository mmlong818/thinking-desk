import { NextResponse } from 'next/server';
import { z } from 'zod';
import { deriveFollowUps } from '@/lib/ai/tasks/derive-follow-ups';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  nodeKind: z.string().min(1).max(20),
  content: z.unknown(),
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
    const items = await deriveFollowUps({
      nodeKind: body.nodeKind,
      content: body.content,
      override: body.model,
    });
    return NextResponse.json({ ok: true, data: { follow_ups: items } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[derive-follow-ups] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
