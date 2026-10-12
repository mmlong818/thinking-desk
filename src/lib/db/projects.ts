import { query } from './client';

const DEMO_OWNER_ID = '00000000-0000-0000-0000-000000000001';

export interface ProjectRow {
  id: string;
  owner_id: string;
  name: string;
  slug: string;
  summary: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface ProjectSummary extends ProjectRow {
  node_count: number;
  last_node_kind: string | null;
  last_node_at: Date | null;
}

export async function listProjects(ownerId: string = DEMO_OWNER_ID): Promise<ProjectSummary[]> {
  return query<ProjectSummary>(
    `SELECT
       p.*,
       COALESCE(n.cnt, 0)::int AS node_count,
       n.last_kind AS last_node_kind,
       n.last_at   AS last_node_at
     FROM projects p
     LEFT JOIN LATERAL (
       SELECT COUNT(DISTINCT node) AS cnt,
              (array_agg(node ORDER BY updated_at DESC))[1] AS last_kind,
              MAX(updated_at) AS last_at
       FROM items
       WHERE project_id = p.id AND deleted_at IS NULL
     ) n ON true
     WHERE p.owner_id = $1
     ORDER BY p.updated_at DESC`,
    [ownerId],
  );
}

export async function createProject(args: {
  name: string;
  summary?: string | null;
  slug?: string;
  ownerId?: string;
}): Promise<ProjectRow> {
  const ownerId = args.ownerId ?? DEMO_OWNER_ID;
  const slug = args.slug ?? toSlug(args.name);
  const rows = await query<ProjectRow>(
    `INSERT INTO projects (owner_id, name, slug, summary)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
    [ownerId, args.name, slug, args.summary ?? null],
  );
  return rows[0];
}

/** URL slug from a project name: lowercase words (CJK kept) + a 4-char random suffix. */
export function toSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'proj'}-${suffix}`;
}

export interface NodeRow<T = Record<string, unknown>> {
  id: string;
  project_id: string;
  kind: string;
  content: T;
  completeness: number;
  updated_at: Date;
}

export async function findProjectBySlug(slug: string): Promise<ProjectRow | null> {
  const rows = await query<ProjectRow>(
    'SELECT * FROM projects WHERE slug = $1 ORDER BY updated_at DESC LIMIT 1',
    [slug],
  );
  return rows[0] ?? null;
}

// Legacy node-blob reader for the `nodes` table, which schema.sql dropped in
// Phase 1. Its only caller (the node page) catches DB errors, so it fails softly
// until node pages move to PgRepository. AI routes no longer touch the database.

/** @deprecated `nodes` table dropped; use PgRepository. */
export async function getNode<T = Record<string, unknown>>(
  projectId: string,
  kind: string,
): Promise<NodeRow<T> | null> {
  const rows = await query<NodeRow<T>>(
    'SELECT * FROM nodes WHERE project_id = $1 AND kind = $2',
    [projectId, kind],
  );
  return rows[0] ?? null;
}
