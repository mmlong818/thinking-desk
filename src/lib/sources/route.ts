import { z } from 'zod';
import { SourceCheckRequestSchema } from './protocol';
import { verifySources, type VerifyDeps } from './verify';

/**
 * POST handler for /api/sources/verify: `{ sources: [{ url, title?, subject? }] }` (1–20) →
 * `{ ok: true, results }` in request order. Network access and DNS are injectable for tests.
 */
export function createSourceCheckRoute(deps: VerifyDeps = {}) {
  return async function POST(req: Request): Promise<Response> {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return Response.json({ error: 'invalid body', detail: 'body is not JSON' }, { status: 400 });
    }
    const parsed = SourceCheckRequestSchema.safeParse(raw);
    if (!parsed.success) return Response.json({ error: 'invalid body', detail: z.prettifyError(parsed.error) }, { status: 400 });
    const results = await verifySources(parsed.data.sources, deps);
    return Response.json({ ok: true, results });
  };
}
