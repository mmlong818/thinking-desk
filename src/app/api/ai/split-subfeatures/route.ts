import { NextResponse } from 'next/server';
import { z } from 'zod';
import { splitSubfeatures } from '@/lib/ai/tasks/split-subfeatures';
import { findProjectBySlug, getNode, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { DesignProposal } from '@/lib/ai/tasks/generate-design';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  projectSlug: z.string().min(1),
  design: z.unknown().optional(),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }

  let design = body.design as DesignProposal | undefined;
  let projectId: string | null = null;

  try {
    const project = await findProjectBySlug(body.projectSlug);
    if (project) {
      projectId = project.id;
      if (!design) {
        const r = await getNode<DesignProposal>(project.id, 'design');
        if (r?.content) design = r.content;
      }
    }
  } catch (e) {
    console.warn('[split-subfeatures] DB unreachable:', e instanceof Error ? e.message : e);
  }

  if (!design) {
    return NextResponse.json({ error: 'missing_design', detail: '需要先在 08 生成设计案' }, { status: 400 });
  }

  try {
    const started = Date.now();
    const result = await splitSubfeatures({ design, override: body.model });
    const latency = Date.now() - started;

    if (projectId) {
      try {
        await upsertNode(projectId, 'split', result as unknown as Record<string, unknown>, 90);
        const resolved = await providerFor('SPLIT_SUBFEATURES', body.model);
        await logAiExchange({
          projectId, nodeKind: 'split', task: 'SPLIT_SUBFEATURES', kind: 'feed',
          prompt: JSON.stringify({ modules: design.modules.length }),
          response: result,
          provider: resolved.provider, model: resolved.model,
          latencyMs: latency,
        });
      } catch (e) {
        console.warn('[split-subfeatures] persist failed:', e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[split-subfeatures] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
