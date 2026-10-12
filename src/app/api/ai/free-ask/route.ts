import { z } from 'zod';
import { getNode as getNodeMeta } from '@/data/nodes';
import { aiRoute, ModelOverrideSchema, RouteError } from '@/lib/ai/route';
import { freeAsk } from '@/lib/ai/tasks/free-ask';

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
  model: ModelOverrideSchema,
});

export const POST = aiRoute({
  name: 'free-ask',
  body: Body,
  timeoutMs: 110_000,
  async handle(body, opts) {
    const meta = getNodeMeta(body.nodeKind);
    if (!meta) throw new RouteError(400, 'invalid node kind');
    // Cross-node context comes with the node migration (repositories); until then it is empty.
    const res = await freeAsk(
      { nodeKind: body.nodeKind, nodeLabel: meta.label, contextSummary: '', question: body.question, history: body.history },
      opts,
    );
    return { ...res, data: { text: res.data, provider: res.run.provider, model: res.run.model } };
  },
});
