import {
  DIMENSION_KEYS,
  type DimensionsResult,
  type ScenarioDeepAnalysis,
  type ScenarioDrafts,
} from '../../ai/schemas/analyze-scenarios';
import type { ItemStance } from '../../ai/schemas/stance';
import type { ItemDraft } from '../repository';
import type { ItemType } from '../types';
import { critiqueDrafts, modelStance, recommend, scopes, type AdaptedOutput } from './common';

export const SCEN_ELEMENT_REASON = '与 Brief / 已锁 Jobs 高相关';

/**
 * SCEN_FEED (exhaust): one `scenario_element` per candidate; high relevance was pre-selected before.
 * Nothing in this output refers to an element, so a temp id reused across dimensions just loses
 * its ref (the ref only matters when the AI echoes an existing element's permanent id).
 */
export function adaptDimensions(out: DimensionsResult): AdaptedOutput {
  const seen = new Set<string>();
  const drafts = DIMENSION_KEYS.flatMap((dim) =>
    out.dimensions[dim].map((e): ItemDraft => {
      const ref = seen.has(e.id) ? undefined : e.id;
      seen.add(e.id);
      return {
        ...(ref ? { ref } : {}),
        type: 'scenario_element',
        body: { ...e, dim },
        ...(e.relevance === 'high' ? { aiStance: recommend(SCEN_ELEMENT_REASON) } : {}),
      };
    }),
  );
  return { drafts, replace: scopes('scen', 'scenario_element') };
}

/** SCEN_FEED (combine): scenarios; element_ids / job_ids become Links to the existing items. */
export function adaptScenarioDrafts(out: ScenarioDrafts): AdaptedOutput {
  const drafts = out.scenarios.map((s): ItemDraft => ({ ref: s.id, type: 'scenario', body: s }));
  return { drafts, replace: scopes('scen', 'scenario') };
}

/** One draft per entity the model gave a verdict on; the verdict becomes aiStance (missing → neutral), not part of the body. */
function stancedDrafts(type: ItemType, entities: ReadonlyArray<{ id: string; stance: ItemStance }>): ItemDraft[] {
  return entities.map(({ stance, ...body }): ItemDraft => ({ ref: body.id, type, body, aiStance: modelStance(stance) }));
}

/**
 * SCEN_PAIN (deep): matrix, extremes, hostiles, pain / delight points, insights and critiques;
 * extremes, hostiles, pain points and insights carry the model's own verdict as aiStance.
 */
export function adaptDeepAnalysis(out: ScenarioDeepAnalysis): AdaptedOutput {
  const drafts: ItemDraft[] = [
    ...out.matrix.map((c): ItemDraft => ({ type: 'matrix_cell', body: c })),
    ...stancedDrafts('extreme', out.extremes),
    ...stancedDrafts('hostile', out.hostiles),
    ...stancedDrafts('pain_point', out.pain_points),
    ...out.delight_points.map((d): ItemDraft => ({ ref: d.id, type: 'delight_point', body: d })),
    ...stancedDrafts('insight', out.design_insights),
    ...critiqueDrafts(out.critiques),
  ];
  return {
    drafts,
    replace: scopes('scen', 'matrix_cell', 'extreme', 'hostile', 'pain_point', 'delight_point', 'insight', 'critique'),
  };
}
