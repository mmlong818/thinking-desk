import { refreshLinks } from '@/lib/api/project-api';
import { PgRepository } from '@/lib/db/pg-repository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const repo = new PgRepository();

/** "Still holds after the upstream change": `{ linkIds, note? }` → toVersionSeen := current version. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return refreshLinks(repo, (await params).id, req);
}
