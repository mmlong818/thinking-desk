import { NextResponse } from 'next/server';
import { z } from 'zod';
import { analyzeCreativeLeap, generateMoreLeapItems } from '@/lib/ai/tasks/creative-leap';
import { findProjectBySlug, getNode, logAiExchange, upsertNode } from '@/lib/db/projects';
import { providerFor } from '@/lib/ai/router';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/tasks/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/tasks/analyze-users';
import type { Feature, FeatureList } from '@/lib/ai/tasks/draft-features';
import type { AlternativesAnalysis } from '@/lib/ai/tasks/analyze-alternatives';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const Body = z.object({
  action: z.enum(['initial', 'more']).default('initial'),
  projectSlug: z.string().min(1),
  brief: z.unknown().optional(),
  rawText: z.string().optional(),
  answers: z.unknown().optional(),
  personas: z.array(z.unknown()).optional(),
  lockedJobs: z.array(z.unknown()).optional(),
  features: z.array(z.unknown()).optional(),
  differentiation_hypothesis: z.string().optional(),
  alt_threats: z.array(z.string()).optional(),
  model: z.string().optional(),
  // 增量生成参数
  category: z.enum(['first_principles', 'analogies', 'constraint_flips']).optional(),
  existing: z.array(z.unknown()).optional(),
  locked_ids: z.array(z.string()).optional(),
  rejected_ids: z.array(z.string()).optional(),
});

interface BriefNodeRow {
  raw_text?: string;
  answers?: ClarificationAnswer[];
  highlights: BriefExtraction['highlights'];
  fields: BriefExtraction['fields'];
  follow_ups: BriefExtraction['follow_ups'];
}
interface UsersNodeRow extends UsersAnalysis {
  extraPersonas?: Persona[];
  personaLocked?: Record<string, boolean>;
  jobLocked?: Record<string, boolean>;
}

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); }
  catch (e) { return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 }); }

  let brief: BriefExtraction | null = null;
  let rawText = body.rawText;
  let answers = Array.isArray(body.answers) ? (body.answers as ClarificationAnswer[]) : undefined;
  let personas: Persona[] = (body.personas as Persona[]) ?? [];
  let lockedJobs: Job[] = (body.lockedJobs as Job[]) ?? [];
  let features: Feature[] = (body.features as Feature[]) ?? [];
  let diff_hypothesis = body.differentiation_hypothesis;
  let alt_threats = body.alt_threats;

  if (body.brief && typeof body.brief === 'object') brief = body.brief as BriefExtraction;

  let projectId: string | null = null;
  try {
    const project = await findProjectBySlug(body.projectSlug);
    if (project) {
      projectId = project.id;
      if (!brief) {
        const r = await getNode<BriefNodeRow>(project.id, 'brief');
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
      if (personas.length === 0 || lockedJobs.length === 0) {
        const u = await getNode<UsersNodeRow>(project.id, 'users');
        if (u?.content) {
          const all = [...u.content.personas, ...(u.content.extraPersonas ?? [])];
          const pLocked = u.content.personaLocked ?? {};
          if (personas.length === 0) personas = all.filter((p) => pLocked[p.id]);
          if (lockedJobs.length === 0) {
            const jLocked = u.content.jobLocked ?? {};
            const allJobs = [
              ...u.content.jobs.functional,
              ...u.content.jobs.emotional,
              ...u.content.jobs.social,
            ];
            lockedJobs = allJobs.filter((j) => jLocked[j.id]);
          }
        }
      }
      if (features.length === 0) {
        const f = await getNode<FeatureList>(project.id, 'feat');
        if (f?.content?.features) features = f.content.features;
      }
      if (!diff_hypothesis || !alt_threats) {
        const a = await getNode<AlternativesAnalysis>(project.id, 'alt');
        if (a?.content) {
          diff_hypothesis = diff_hypothesis ?? a.content.differentiation_hypothesis;
          alt_threats = alt_threats ?? a.content.key_threats;
        }
      }
    }
  } catch (e) {
    console.warn('[creative-leap] DB unreachable:', e instanceof Error ? e.message : e);
  }

  if (!brief) {
    return NextResponse.json({ error: 'missing_brief', detail: '需要 Brief 上下文' }, { status: 400 });
  }

  try {
    const started = Date.now();

    if (body.action === 'more') {
      if (!body.category) {
        return NextResponse.json({ error: 'missing_category' }, { status: 400 });
      }
      const result = await generateMoreLeapItems({
        brief, rawText, answers, personas, lockedJobs, features,
        differentiation_hypothesis: diff_hypothesis,
        alt_threats,
        category: body.category,
        existing: body.existing ?? [],
        locked_ids: body.locked_ids ?? [],
        rejected_ids: body.rejected_ids ?? [],
        override: body.model,
      });
      return NextResponse.json({ ok: true, data: result });
    }

    const result = await analyzeCreativeLeap({
      brief, rawText, answers, personas, lockedJobs, features,
      differentiation_hypothesis: diff_hypothesis,
      alt_threats,
      override: body.model,
    });
    const latency = Date.now() - started;
    if (projectId) {
      try {
        await upsertNode(projectId, 'leap', result, 70);
        const resolved = await providerFor('LEAP_FIRST_PRINCIPLES', body.model);
        await logAiExchange({
          projectId, nodeKind: 'leap', task: 'LEAP_FIRST_PRINCIPLES', kind: 'feed',
          prompt: JSON.stringify({ features: features.length }),
          response: result,
          provider: resolved.provider, model: resolved.model,
          latencyMs: latency,
        });
      } catch (e) {
        console.warn('[creative-leap] persist failed:', e instanceof Error ? e.message : e);
      }
    }
    return NextResponse.json({ ok: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[creative-leap] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message || 'unknown' } : {}) }, { status: 502 });
  }
}
