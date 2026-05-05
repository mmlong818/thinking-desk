import { Home, type ServerProject } from '@/components/home/Home';
import { listProjects } from '@/lib/db/projects';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  let initialProjects: ServerProject[] = [];
  let dbError: string | null = null;
  try {
    const rows = await listProjects();
    initialProjects = rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      summary: r.summary,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
      node_count: r.node_count,
      last_node_kind: r.last_node_kind,
      last_node_at: r.last_node_at ? r.last_node_at.toISOString() : null,
    }));
  } catch (e) {
    dbError = e instanceof Error ? e.message : String(e);
  }
  return <Home initialProjects={initialProjects} dbError={dbError} />;
}
