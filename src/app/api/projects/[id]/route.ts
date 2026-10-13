import { z } from 'zod';
import { errorResponse } from '@/lib/api/project-api';
import { deleteProject, ProjectIdSchema } from '@/lib/db/delete-project';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Params = z.object({ id: ProjectIdSchema });

/** Deletes a Postgres project with its runs, items, links and decision events (404 when missing). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = Params.safeParse(await params);
  if (!parsed.success) {
    return Response.json({ error: 'invalid', detail: z.prettifyError(parsed.error) }, { status: 400 });
  }
  try {
    return Response.json({ ok: true, deleted: await deleteProject(parsed.data.id) });
  } catch (e) {
    return errorResponse('delete-project', e);
  }
}
