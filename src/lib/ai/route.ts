import { z } from 'zod';
import { RunTaskError, type RunTaskResult, type TaskOptions } from './run-task';
import { ClarificationAnswerSchema } from './schemas/extract-brief';
import { BriefSnapshotSchema, type BriefContext } from './schemas/snapshots';
import { RegenerationFeedbackSchema } from '../model/feedback';

// Factory for the /api/ai/* POST handlers: validates the body with Zod, runs the task with the
// request's AbortSignal and a deadline, and answers with the shapes the UI reads today —
// { ok: true, data } on success, { error, detail? } otherwise. `run` (run metadata) and `code`
// (RunTaskError code) are additive fields the current UI ignores.

/** Thrown by a handler for a 4xx answer: becomes `{ error: code, detail? }`. */
export class RouteError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail?: string) {
    super(detail ?? code);
    this.name = 'RouteError';
  }
}

export const ModelOverrideSchema = z.string().max(200).optional();

/** Upstream context most node routes accept (the UI sends cached node output). */
export const BriefContextFields = {
  projectSlug: z.string().min(1),
  brief: BriefSnapshotSchema.optional(),
  rawText: z.string().max(20000).optional(),
  answers: z.array(ClarificationAnswerSchema).optional(),
  model: ModelOverrideSchema,
  /** The person's judgments on the items a run regenerates (accepted / rejected + note). */
  feedback: RegenerationFeedbackSchema.optional(),
};

export function requireBrief(brief: BriefContext | undefined, detail = '需要 Brief 上下文'): BriefContext {
  if (!brief) throw new RouteError(400, 'missing_brief', detail);
  return brief;
}

export interface AiRouteDef<B extends z.ZodType<{ model?: string }>> {
  /** Log prefix. */
  name: string;
  body: B;
  /** Deadline for the AI call; keep it below the route's maxDuration. */
  timeoutMs?: number;
  handle(body: z.output<B>, opts: TaskOptions): Promise<RunTaskResult<unknown>>;
}

export function aiRoute<B extends z.ZodType<{ model?: string }>>(def: AiRouteDef<B>) {
  return async function POST(req: Request): Promise<Response> {
    const parsed = await readBody(req, def.body);
    if (!parsed.ok) return Response.json({ error: 'invalid body', detail: parsed.detail }, { status: 400 });
    try {
      const opts: TaskOptions = { model: parsed.body.model, signal: req.signal, timeoutMs: def.timeoutMs };
      const { data, run } = await def.handle(parsed.body, opts);
      return Response.json({ ok: true, data, run });
    } catch (e) {
      return errorResponse(def.name, e);
    }
  };
}

async function readBody<B extends z.ZodType>(
  req: Request, schema: B,
): Promise<{ ok: true; body: z.output<B> } | { ok: false; detail: string }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch (e) {
    return { ok: false, detail: `body is not JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const result = schema.safeParse(raw);
  return result.success ? { ok: true, body: result.data } : { ok: false, detail: z.prettifyError(result.error) };
}

const STATUS: Partial<Record<RunTaskError['code'], number>> = { timeout: 504, aborted: 499 };

function errorResponse(name: string, e: unknown): Response {
  if (e instanceof RouteError) {
    return Response.json({ error: e.code, ...(e.detail ? { detail: e.detail } : {}) }, { status: e.status });
  }
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[${name}] failed:`, message, e instanceof RunTaskError ? '' : (e as Error)?.stack ?? '');
  // Provider error text can carry internal details: only development responses include it.
  const dev = process.env.NODE_ENV !== 'production';
  const detail = dev ? { detail: message || 'unknown error' } : {};
  if (!(e instanceof RunTaskError)) return Response.json({ error: 'ai_failed', ...detail }, { status: 502 });
  const run = dev ? e.run : { ...e.run, error: undefined };
  return Response.json({ error: 'ai_failed', code: e.code, run, ...detail }, { status: STATUS[e.code] ?? 502 });
}
