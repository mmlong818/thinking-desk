import { getGraph } from '@/lib/api/project-api';
import { PgRepository } from '@/lib/db/pg-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repo = new PgRepository();

/** Live items and the links between them (Postgres mode). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return getGraph(repo, (await params).id);
}
