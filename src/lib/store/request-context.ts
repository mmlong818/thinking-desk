import type { Job, Persona } from '../ai/schemas/analyze-users';
import type { BriefRequestContext, ItemOfType } from '../model/context';
import type { Link, LinkRel } from '../model/types';

// Upstream items → the shapes the /api/ai/* request bodies validate. Items travel under their
// permanent ids, so whatever the AI references comes back as resolvable Links.

/** Ids an item points to over one relation. */
export function linkedIds(links: readonly Link[], fromId: string, rel: LinkRel): string[] {
  return links.filter((l) => l.from === fromId && l.rel === rel).map((l) => l.to);
}

/** Ids pointing at an item over one relation (reverse direction). */
export function linkingIds(links: readonly Link[], toId: string, rel: LinkRel): string[] {
  return links.filter((l) => l.to === toId && l.rel === rel).map((l) => l.from);
}

export function briefPayload(ctx: BriefRequestContext) {
  return {
    brief: ctx.brief,
    ...(ctx.rawText ? { rawText: ctx.rawText } : {}),
    ...(ctx.answers ? { answers: ctx.answers } : {}),
  };
}

export function personaPayload(p: ItemOfType<'persona'>): Persona {
  return { ...p.body, id: p.id };
}

export function jobPayload(j: ItemOfType<'job'>, links: readonly Link[]): Job {
  const { dimension: _dimension, ...body } = j.body;
  return {
    ...body,
    id: j.id,
    persona_ids: linkedIds(links, j.id, 'derived_from'),
    suggested_priority: j.aiStance?.verdict === 'recommend',
  };
}

export function jobsByDimension(jobs: readonly ItemOfType<'job'>[], links: readonly Link[]) {
  const pick = (d: 'functional' | 'emotional' | 'social') =>
    jobs.filter((j) => j.body.dimension === d).map((j) => jobPayload(j, links));
  return { functional: pick('functional'), emotional: pick('emotional'), social: pick('social') };
}
