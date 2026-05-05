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
       SELECT COUNT(*) AS cnt,
              (array_agg(kind ORDER BY updated_at DESC))[1] AS last_kind,
              MAX(updated_at) AS last_at
       FROM nodes
       WHERE project_id = p.id
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

function toSlug(name: string): string {
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

export async function upsertNode(
  projectId: string,
  kind: string,
  content: Record<string, unknown>,
  completeness: number,
): Promise<void> {
  await query(
    `INSERT INTO nodes (project_id, kind, content, completeness)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (project_id, kind) DO UPDATE
         SET content = EXCLUDED.content,
             completeness = EXCLUDED.completeness,
             updated_at = now()`,
    [projectId, kind, JSON.stringify(content), completeness],
  );
}

export async function logAiExchange(args: {
  projectId: string;
  nodeKind: string;
  task: string;
  kind: 'feed' | 'ask' | 'check' | 'critique';
  prompt: string;
  response: unknown;
  provider: string;
  model: string;
  latencyMs: number;
}): Promise<void> {
  await query(
    `INSERT INTO ai_exchanges (project_id, node_kind, task, kind, prompt, response, provider, model, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
    [
      args.projectId,
      args.nodeKind,
      args.task,
      args.kind,
      args.prompt,
      JSON.stringify(args.response),
      args.provider,
      args.model,
      args.latencyMs,
    ],
  );
}
