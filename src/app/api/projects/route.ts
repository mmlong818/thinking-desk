import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createProject, listProjects } from '@/lib/db/projects';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await listProjects();
    return NextResponse.json({
      ok: true,
      projects: rows.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        summary: r.summary,
        created_at: r.created_at,
        updated_at: r.updated_at,
        node_count: r.node_count,
        last_node_kind: r.last_node_kind,
        last_node_at: r.last_node_at,
      })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[projects] list failed, returning empty list:', message);
    return NextResponse.json({ ok: true, projects: [], db_error: message });
  }
}

const CreateBody = z.object({
  name: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof CreateBody>;
  try {
    body = CreateBody.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }
  try {
    const project = await createProject({ name: body.name, summary: body.summary ?? null });
    return NextResponse.json({ ok: true, project });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[projects] create failed:', message);
    return NextResponse.json(
      { error: 'db_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message } : {}) },
      { status: 502 },
    );
  }
}
