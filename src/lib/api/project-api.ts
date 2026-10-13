import { z } from 'zod';
import { AI_TASKS } from '../ai/types';
import {
  RepositoryError,
  type Repository,
  type RepositoryErrorCode,
} from '../model/repository';
import {
  AiStanceSchema,
  DECISIONS,
  EvidenceSchema,
  ItemTypeSchema,
  LINK_RELS,
  NodeKindSchema,
  RunSchema,
} from '../model/types';

// Handlers behind /api/projects/[id]/* — the browser's Repository in Postgres mode. Each takes
// the repository explicitly so tests run them against LocalRepository; the route files pass a
// PgRepository. Every write is attributed to the human (actor 'human'); AI writes only arrive
// through saveRunOutput as a run.

/** The Repository surface the UI uses (pure-local LocalRepository or the HTTP client). */
export type ProjectRepository = Pick<
  Repository,
  'getGraph' | 'listRuns' | 'saveRunOutput' | 'updateItem' | 'createItem' | 'acceptRecommended'
>;

const Note = z.string().trim().max(2000);

export const CreateItemBodySchema = z.object({
  node: NodeKindSchema,
  type: ItemTypeSchema,
  body: z.unknown(),
  decision: z.enum(DECISIONS).optional(),
  decisionNote: Note.optional(),
  links: z.array(z.object({ to: z.string().min(1), rel: z.enum(LINK_RELS) })).max(100).optional(),
});

export const UpdateItemBodySchema = z.object({
  patch: z.object({
    body: z.unknown().optional(),
    decision: z.enum(DECISIONS).optional(),
    decisionNote: Note.nullable().optional(),
    deleted: z.literal(true).optional(),
  }),
  note: Note.optional(),
});

export const AcceptRecommendedBodySchema = z.object({ node: NodeKindSchema, note: Note.optional() });

const DraftLinkSchema = z.object({
  ref: z.string().min(1),
  rel: z.enum(LINK_RELS),
  to: z.array(ItemTypeSchema).min(1),
  node: NodeKindSchema.optional(),
});

export const SaveRunBodySchema = z.object({
  run: RunSchema.omit({ id: true, projectId: true, createdAt: true }).extend({ task: z.enum(AI_TASKS) }),
  drafts: z
    .array(z.object({
      ref: z.string().min(1).max(200).optional(),
      type: ItemTypeSchema,
      node: NodeKindSchema.optional(),
      body: z.unknown(),
      aiStance: AiStanceSchema.optional(),
      evidence: EvidenceSchema.optional(),
      links: z.array(DraftLinkSchema).max(50).optional(),
    }))
    .max(500),
  replace: z.array(z.object({ node: NodeKindSchema, type: ItemTypeSchema })).max(30),
});

const STATUS: Record<RepositoryErrorCode, number> = { not_found: 404, invalid: 400, conflict: 409, storage: 503 };

export function errorResponse(tag: string, e: unknown): Response {
  if (e instanceof RepositoryError) {
    return Response.json({ error: e.code, detail: e.message }, { status: STATUS[e.code] });
  }
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[${tag}] failed:`, message);
  // Without DATABASE_URL, or with the database down, every PgRepository call rejects here.
  const dev = process.env.NODE_ENV !== 'production';
  return Response.json({ error: 'db_unavailable', ...(dev ? { detail: message } : {}) }, { status: 503 });
}

async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.output<S>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new RepositoryError('invalid', 'body is not JSON');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw new RepositoryError('invalid', z.prettifyError(parsed.error));
  return parsed.data;
}

async function handle(tag: string, fn: () => Promise<Record<string, unknown>>): Promise<Response> {
  try {
    return Response.json({ ok: true, ...(await fn()) });
  } catch (e) {
    return errorResponse(tag, e);
  }
}

export const getGraph = (repo: ProjectRepository, projectId: string) =>
  handle('graph', async () => ({ graph: await repo.getGraph(projectId) }));

export function listRuns(repo: ProjectRepository, projectId: string, url: URL) {
  return handle('runs', async () => {
    const node = NodeKindSchema.safeParse(url.searchParams.get('node'));
    return { runs: await repo.listRuns(projectId, node.success ? { node: node.data } : {}) };
  });
}

export const saveRun = (repo: ProjectRepository, projectId: string, req: Request) =>
  handle('save-run', async () => ({ result: await repo.saveRunOutput(projectId, await readJson(req, SaveRunBodySchema)) }));

export const createItem = (repo: ProjectRepository, projectId: string, req: Request) =>
  handle('create-item', async () => ({ item: await repo.createItem(projectId, await readJson(req, CreateItemBodySchema)) }));

export function updateItem(repo: ProjectRepository, projectId: string, itemId: string, req: Request) {
  return handle('update-item', async () => {
    const { patch, note } = await readJson(req, UpdateItemBodySchema);
    return { item: await repo.updateItem(projectId, itemId, patch, { actor: 'human', ...(note ? { note } : {}) }) };
  });
}

export function acceptRecommended(repo: ProjectRepository, projectId: string, req: Request) {
  return handle('accept-recommended', async () => {
    const { node, note } = await readJson(req, AcceptRecommendedBodySchema);
    return { items: await repo.acceptRecommended(projectId, node, note ? { note } : {}) };
  });
}
