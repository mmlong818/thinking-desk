import { listEvents } from '@/lib/api/project-api';
import { PgRepository } from '@/lib/db/pg-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repo = new PgRepository();

/** Decision events, oldest first; `?itemId=` filters. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return listEvents(repo, (await params).id, new URL(req.url));
}
