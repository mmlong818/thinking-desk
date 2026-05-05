import { NextResponse } from 'next/server';
import { z } from 'zod';
import { freeAsk } from '@/lib/ai/tasks/free-ask';
import { findProjectBySlug, getNode } from '@/lib/db/projects';
import { getNode as getNodeMeta } from '@/data/nodes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const Body = z.object({
  projectSlug: z.string().min(1),
  nodeKind: z.string().min(1),
  question: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() }))
    .max(20)
    .default([]),
  model: z.string().optional(),
});

const NODES_FOR_CONTEXT = ['brief', 'users', 'stake', 'alt', 'scen', 'feat', 'leap', 'final', 'split'] as const;

function summarize(kind: string, content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const obj = content as Record<string, unknown>;
  switch (kind) {
    case 'brief': {
      const fields = obj.fields as Record<string, unknown> | undefined;
      const parts: string[] = [];
      if (fields?.problem) parts.push(`问题：${String(fields.problem)}`);
      if (fields?.user) parts.push(`用户：${String(fields.user)}`);
      if (fields?.scenario) parts.push(`场景：${String(fields.scenario)}`);
      if (fields?.value_prop) parts.push(`价值：${String(fields.value_prop)}`);
      return parts.join(' · ').slice(0, 400);
    }
    case 'users': {
      const personas = obj.personas as { name?: string }[] | undefined;
      if (!personas) return '';
      return `Personas: ${personas.map((p) => p.name).filter(Boolean).join(' / ')}`.slice(0, 300);
    }
    case 'feat': {
      const features = obj.features as { name?: string; title?: string }[] | undefined;
      if (!features) return '';
      return `候选功能 ${features.length} 项：${features.map((f) => f.name ?? f.title).filter(Boolean).slice(0, 8).join(' / ')}`.slice(0, 300);
    }
    case 'leap': {
      const cats = obj.categories as Record<string, unknown> | undefined;
      if (!cats) return '';
      return `创造性跃迁候选已生成（多类别）。`;
    }
    case 'final': {
      const modules = obj.modules as { name?: string }[] | undefined;
      if (!modules) return '';
      return `设计案模块：${modules.map((m) => m.name).filter(Boolean).join(' / ')}`.slice(0, 300);
    }
    case 'split': {
      const total = obj.total_subfeatures as number | undefined;
      return total ? `已拆分 ${total} 条子任务` : '';
    }
    default:
      return '';
  }
}

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: 'invalid body', detail: String(e) }, { status: 400 });
  }

  const meta = getNodeMeta(body.nodeKind);
  if (!meta) {
    return NextResponse.json({ error: 'invalid node kind' }, { status: 400 });
  }

  let contextSummary = '';
  try {
    const project = await findProjectBySlug(body.projectSlug);
    if (project) {
      const rows = await Promise.all(
        NODES_FOR_CONTEXT.map(async (k) => {
          try {
            const r = await getNode<Record<string, unknown>>(project.id, k);
            const sum = summarize(k, r?.content);
            return sum ? `[${k}] ${sum}` : '';
          } catch {
            return '';
          }
        }),
      );
      contextSummary = rows.filter(Boolean).join('\n');
    }
  } catch {
    // DB unreachable — fall through with empty context.
  }

  try {
    const result = await freeAsk({
      nodeKind: body.nodeKind,
      nodeLabel: meta.label,
      contextSummary,
      question: body.question,
      history: body.history,
      override: body.model,
    });
    return NextResponse.json({ ok: true, data: { text: result.text, provider: result.provider, model: result.model } });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('[free-ask] failed:', message);
    return NextResponse.json({ error: 'ai_failed', ...(process.env.NODE_ENV !== 'production' ? { detail: message } : {}) }, { status: 502 });
  }
}
