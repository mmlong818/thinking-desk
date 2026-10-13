import { editLinks } from '@/lib/api/project-api';
import { PgRepository } from '@/lib/db/pg-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repo = new PgRepository();

/** Hand edit of Links: `{ add?: [{ from, to, rel }], remove?: [linkId], note? }`, one transaction. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return editLinks(repo, (await params).id, req);
}
