import {
  DIMENSION_KEYS,
  type DimensionsResult,
  type ScenarioDeepAnalysis,
  type ScenarioDrafts,
} from '../../ai/schemas/analyze-scenarios';
import type { ItemDraft } from '../repository';
import { critiqueDrafts, recommend, scopes, type AdaptedOutput } from './common';

export const SCEN_REASON = {
  element: '与 Brief / 已锁 Jobs 高相关',
  extreme: '§8.3 极值情景 · 方法论硬要求',
  hostile: '§8.3 敌意情景 · 方法论硬要求',
  pain: '痛点根因 · 将带入功能列表',
  insight: '§8.5 设计启发 · 将带入功能列表',
} as const;

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
        ...(e.relevance === 'high' ? { aiStance: recommend(SCEN_REASON.element) } : {}),
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

/** SCEN_PAIN (deep): matrix, extremes, hostiles, pain / delight points, insights and critiques. */
export function adaptDeepAnalysis(out: ScenarioDeepAnalysis): AdaptedOutput {
  const drafts: ItemDraft[] = [
    ...out.matrix.map((c): ItemDraft => ({ type: 'matrix_cell', body: c })),
    ...out.extremes.map((x): ItemDraft => ({ ref: x.id, type: 'extreme', body: x, aiStance: recommend(SCEN_REASON.extreme) })),
    ...out.hostiles.map((h): ItemDraft => ({ ref: h.id, type: 'hostile', body: h, aiStance: recommend(SCEN_REASON.hostile) })),
    ...out.pain_points.map((p): ItemDraft => ({ ref: p.id, type: 'pain_point', body: p, aiStance: recommend(SCEN_REASON.pain) })),
    ...out.delight_points.map((d): ItemDraft => ({ ref: d.id, type: 'delight_point', body: d })),
    ...out.design_insights.map((i): ItemDraft => ({ ref: i.id, type: 'insight', body: i, aiStance: recommend(SCEN_REASON.insight) })),
    ...critiqueDrafts(out.critiques),
  ];
  return {
    drafts,
    replace: scopes('scen', 'matrix_cell', 'extreme', 'hostile', 'pain_point', 'delight_point', 'insight', 'critique'),
  };
}
