import { acceptRecommended } from '@/lib/api/project-api';
import { PgRepository } from '@/lib/db/pg-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repo = new PgRepository();

/** Accepts every pending item the AI recommends on one node. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return acceptRecommended(repo, (await params).id, req);
}
