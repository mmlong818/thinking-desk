import { createItem } from '@/lib/api/project-api';
import { PgRepository } from '@/lib/db/pg-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repo = new PgRepository();

/** A human-authored item. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return createItem(repo, (await params).id, req);
}
