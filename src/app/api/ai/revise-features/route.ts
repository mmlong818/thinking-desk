import { NextResponse } from 'next/server';
import { z } from 'zod';
import { reviseFeaturesWithLeaps } from '@/lib/ai/tasks/revise-features';
import { findProjectBySlug, getNode, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/schemas/extract-brief';
import type { FeatureList } from '@/lib/ai/schemas/draft-features';
import type { CreativeLeapAnalysis } from '@/lib/ai/schemas/creative-leap';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  projectSlug: z.string().min(1),
  brief: z.unknown().optional(),
  rawText: z.string().optional(),
  answers: z.unknown().optional(),
  original: z.unknown().optional(),
  leaps: z.unknown().optional(),
  selectedLeapIds: z.array(z.string()).min(1),
  model: z.string().optional(),
});

interface BriefRow {
  raw_text?: string;
  answers?: ClarificationAnswer[];
  highlights: BriefExtraction['highlights'];
  fields: BriefExtraction['fields'];
  follow_ups: BriefExtraction['follow_ups'];
}

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }

  let brief: BriefExtraction | null = null;
  let rawText = body.rawText;
  let answers = Array.isArray(body.answers) ? (body.answers as ClarificationAnswer[]) : undefined;
  let original: FeatureList | null = (body.original as FeatureList) ?? null;
  let leaps: CreativeLeapAnalysis | null = (body.leaps as CreativeLeapAnalysis) ?? null;
  if (body.brief && typeof body.brief === 'object') brief = body.brief as BriefExtraction;

  let projectId: string | null = null;
  try {
    const project = await findProjectBySlug(body.projectSlug);
    if (project) {
      projectId = project.id;
      if (!brief) {
        const r = await getNode<BriefRow>(project.id, 'brief');
        if (r?.content) {
          brief = {
            highlights: r.content.highlights,
            fields: r.content.fields,
            follow_ups: r.content.follow_ups,
            completeness: r.completeness,
          };
          rawText = rawText ?? r.content.raw_text;
          answers = answers ?? r.content.answers;
        }
      }
      if (!original) {
        const f = await getNode<FeatureList>(project.id, 'feat');
        if (f?.content) original = f.content;
      }
      if (!leaps) {
        const l = await getNode<CreativeLeapAnalysis>(project.id, 'leap');
        if (l?.content) leaps = l.content;
      }
    }
  } catch (e) {
    console.warn('[revise-features] DB unreachable:', e instanceof Error ? e.message : e);
  }

  if (!brief) return NextResponse.json({ error: 'missing_brief' }, { status: 400 });
  if (!original) return NextResponse.json({ error: 'missing_features', detail: '需要先完成功能列表' }, { status: 400 });
  if (!leaps) return NextResponse.json({ error: 'missing_leaps', detail: '需要先完成创造性跃迁' }, { status: 400 });

  try {
    const started = Date.now();
    const result = await reviseFeaturesWithLeaps({
      brief, rawText, answers,
      original,
      leaps,
      selectedLeapIds: body.selectedLeapIds,
      override: body.model,
    });
    const latency = Date.now() - started;

    if (projectId) {
      try {
        // 写入独立的 'final' 节点 · 不再动 'feat'
        const finalContent = {
          features: result.revised_features,
          pillars: result.revised_pillars,
          not_doing: result.revised_not_doing,
          differentiation_echo: result.differentiation_echo,
          revision: {
            revisions: result.revisions,
            summary: result.summary,
            critiques: result.critiques,
            selected_leap_ids: body.selectedLeapIds,
            revised_at: new Date().toISOString(),
          },
          source_features: original.features,
          source_pillars: original.pillars,
          source_not_doing: original.not_doing,
          source_differentiation_echo: original.differentiation_echo,
        };
        await upsertNode(
          projectId, 'final',
          finalContent,
          Math.min(100, 60 + result.revised_features.length * 4),
        );
        const resolved = await providerFor('FEAT_DRAFT', body.model);
        await logAiExchange({
          projectId, nodeKind: 'final', task: 'FEAT_DRAFT', kind: 'check',
          prompt: JSON.stringify({ selected_leaps: body.selectedLeapIds.length }),
          response: result,
          provider: resolved.provider, model: resolved.model,
          latencyMs: latency,
        });
      } catch (e) {
        console.warn('[revise-features] persist failed:', e instanceof Error ? e.message : e);
      }
    }

    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[revise-features] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
