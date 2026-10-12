import { z } from 'zod';
import { aiRoute, BriefContextFields, requireBrief, RouteError } from '@/lib/ai/route';
import { PersonaSchema, type Persona } from '@/lib/ai/schemas/analyze-users';
import { generateMorePersonas } from '@/lib/ai/tasks/analyze-users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PERSONAS = 10;

const Body = z.object({
  ...BriefContextFields,
  existing: z.array(PersonaSchema),
  lockedIds: z.array(z.string()),
});

/** Keeps ids unique across the full pool (the model may reuse an existing id). */
function dedupe(batch: Persona[], existing: Persona[]): Persona[] {
  const ids = new Set(existing.map((p) => p.id));
  return batch.map((p, i) => {
    const id = ids.has(p.id) ? `${p.id}_v${existing.length + i + 1}` : p.id;
    ids.add(id);
    return { ...p, id };
  });
}

export const POST = aiRoute({
  name: 'add-personas',
  body: Body,
  async handle(body, opts) {
    if (body.existing.length >= MAX_PERSONAS) throw new RouteError(409, 'limit_reached', '已达 10 个上限');
    const brief = requireBrief(body.brief, '需要 Brief 上下文');
    const res = await generateMorePersonas(
      { brief, rawText: body.rawText, answers: body.answers, existing: body.existing, lockedIds: body.lockedIds },
      opts,
    );
    return { ...res, data: { personas: dedupe(res.data.personas, body.existing) } };
  },
});
