import { listRuns, saveRun } from '@/lib/api/project-api';
import { PgRepository } from '@/lib/db/pg-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repo = new PgRepository();

/** Runs, newest first; `?node=<kind>` filters. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return listRuns(repo, (await params).id, new URL(req.url));
}

/** Saves one AI run with its output drafts (Repository.saveRunOutput). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return saveRun(repo, (await params).id, req);
}
