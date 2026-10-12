import { NextResponse } from 'next/server';
import { z } from 'zod';
import { generateDesignProposal } from '@/lib/ai/tasks/generate-design';
import { findProjectBySlug, getNode, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { BriefExtraction } from '@/lib/ai/schemas/extract-brief';
import type { Feature, FeatureList, Pillar } from '@/lib/ai/schemas/draft-features';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  projectSlug: z.string().min(1),
  brief: z.unknown().optional(),
  features: z.array(z.unknown()).optional(),
  pillars: z.array(z.unknown()).optional(),
  model: z.string().optional(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }

  let brief = body.brief as BriefExtraction | undefined;
  let features = (body.features as Feature[] | undefined) ?? [];
  let pillars = (body.pillars as Pillar[] | undefined) ?? [];
  let projectId: string | null = null;

  try {
    const project = await findProjectBySlug(body.projectSlug);
    if (project) {
      projectId = project.id;
      if (!brief) {
        const r = await getNode<BriefExtraction & Record<string, unknown>>(project.id, 'brief');
        if (r?.content) {
          brief = {
            highlights: r.content.highlights,
            fields: r.content.fields,
            follow_ups: r.content.follow_ups,
            completeness: r.completeness,
          };
        }
      }
      if (features.length === 0) {
        const f = await getNode<FeatureList>(project.id, 'final');
        if (f?.content?.features) {
          features = f.content.features;
          pillars = f.content.pillars ?? [];
        } else {
          const f2 = await getNode<FeatureList>(project.id, 'feat');
          if (f2?.content) {
            features = f2.content.features;
            pillars = f2.content.pillars;
          }
        }
      }
    }
  } catch (e) {
    console.warn('[generate-design] DB unreachable:', e instanceof Error ? e.message : e);
  }

  if (!brief) {
    return NextResponse.json({ error: 'missing_brief', detail: '需要 Brief 上下文' }, { status: 400 });
  }
  if (features.length === 0) {
    return NextResponse.json({ error: 'missing_features', detail: '需要先完成功能列表 / 跃迁节点' }, { status: 400 });
  }

  try {
    const started = Date.now();
    const result = await generateDesignProposal({ brief, features, pillars, override: body.model });
    const latency = Date.now() - started;

    if (projectId) {
      try {
        await upsertNode(projectId, 'design', result as unknown as Record<string, unknown>, 80);
        const resolved = await providerFor('DESIGN_PROPOSAL', body.model);
        await logAiExchange({
          projectId, nodeKind: 'final', task: 'DESIGN_PROPOSAL', kind: 'feed',
          prompt: JSON.stringify({ features: features.length, pillars: pillars.length }),
          response: result,
          provider: resolved.provider, model: resolved.model,
          latencyMs: latency,
        });
      } catch (e) {
        console.warn('[generate-design] persist failed:', e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[generate-design] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
