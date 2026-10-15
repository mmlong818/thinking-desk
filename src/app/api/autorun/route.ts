import { NextResponse } from 'next/server';
import { z } from 'zod';
import { startAutorun } from '@/lib/autorun/service';
import { dbFailure } from './respond';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().trim().min(1).max(120),
  rawText: z.string().trim().min(1).max(20_000),
  model: z.string().trim().min(1).max(100).optional(),
});

/** Starts a headless run of every node; poll GET /api/autorun/<runId>. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'invalid body', issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) }, { status: 400 });
  }
  const origin = process.env.AUTORUN_PUBLIC_URL?.replace(/\/+$/, '') || new URL(req.url).origin;
  try {
    const row = await startAutorun({ ...parsed.data, origin });
    return NextResponse.json(
      { runId: row.id, projectId: row.projectId, slug: row.slug, statusUrl: `/api/autorun/${row.id}` },
      { status: 202 },
    );
  } catch (e) {
    return dbFailure(e);
  }
}
