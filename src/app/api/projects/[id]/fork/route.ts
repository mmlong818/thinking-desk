import { z } from 'zod';
import { errorResponse } from '@/lib/api/project-api';
import { forkProject } from '@/lib/db/fork-project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  summary: z.string().trim().max(500).optional(),
});

/** Branches a Postgres project: new project row + copies of its runs, items, links and events. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'invalid', detail: z.prettifyError(parsed.error) }, { status: 400 });
  }
  try {
    const project = await forkProject((await params).id, parsed.data);
    return Response.json({ ok: true, project: { id: project.id, slug: project.slug, name: project.name } });
  } catch (e) {
    return errorResponse('fork', e);
  }
}
