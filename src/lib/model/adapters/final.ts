import type { Feature } from '../../ai/schemas/draft-features';
import type { DesignProposal } from '../../ai/schemas/generate-design';
import type { FeatureRevision } from '../../ai/schemas/revise-features';
import type { DraftLink, ItemDraft } from '../repository';
import { critiqueDrafts, recommend, scopes, summaryDraft, type AdaptedOutput } from './common';
import { featureDrafts, notDoingDrafts, pillarDrafts } from './features';

export interface ReviseFeaturesContext {
  /** Permanent ids of the `feat` features sent as the original list. */
  originalFeatureIds: readonly string[];
}

/** A revised feature derives from the `feat` original it modifies or keeps (kept features reuse the id). */
function lineageFor(out: FeatureRevision, originals: ReadonlySet<string>) {
  return (f: Feature): DraftLink[] => {
    const noted = out.revisions.find((r) => r.feature_id === f.id && r.original_feature_id)?.original_feature_id;
    const original = noted ?? (originals.has(f.id) ? f.id : undefined);
    return original ? [{ ref: original, rel: 'derived_from', to: ['feature'], node: 'feat' }] : [];
  };
}

/**
 * FEAT_DRAFT (revise with leaps) → the revised list on node `final` (pillars, features with
 * lineage Links to their `feat` originals, not-doing), revision notes, the revision summary,
 * the new differentiation echo and critiques.
 */
export function adaptFeatureRevision(out: FeatureRevision, ctx: ReviseFeaturesContext): AdaptedOutput {
  const originals = new Set(ctx.originalFeatureIds);
  return {
    drafts: [
      ...pillarDrafts(out.revised_pillars, 'final'),
      ...featureDrafts(out.revised_features, out.revised_pillars, 'final', lineageFor(out, originals)),
      ...notDoingDrafts(out.revised_not_doing, 'final'),
      ...out.revisions.map((r): ItemDraft => ({ type: 'revision', node: 'final', body: r })),
      ...summaryDraft('revision', out.summary, { node: 'final' }),
      ...summaryDraft('differentiation_echo', out.differentiation_echo, { node: 'final' }),
      ...critiqueDrafts(out.critiques, 'final'),
    ],
    replace: scopes('final', 'pillar', 'feature', 'not_doing', 'revision', 'summary', 'critique'),
  };
}

export const DESIGN_REASON = 'AI 设计案的组成部分 · 可整体采纳后逐条修改';

function section(body: Record<string, unknown>): ItemDraft {
  return { type: 'design_section', node: 'final', body, aiStance: recommend(DESIGN_REASON) };
}

function titled(kind: 'ia' | 'interaction' | 'tech', list: DesignProposal['information_architecture']): ItemDraft[] {
  return list.map(({ title, body }) => section({ kind, title, body }));
}

function designSections(d: DesignProposal): ItemDraft[] {
  return [
    section({ kind: 'overview', title: d.title, one_liner: d.one_liner, vision: d.vision }),
    section({ kind: 'principles', items: d.design_principles }),
    ...titled('ia', d.information_architecture),
    ...d.user_flows.map(({ id: _id, ...flow }) => section({ kind: 'flow', ...flow })),
    ...titled('interaction', d.key_interactions),
    ...d.data_model.map((e) => section({ kind: 'data_entity', ...e })),
    ...titled('tech', d.tech_skeleton),
    ...d.metrics.map((m) => section({ kind: 'metric', ...m })),
    ...d.risks.map((r) => section({ kind: 'risk', ...r })),
    ...d.milestones.map((m) => section({ kind: 'milestone', ...m })),
    ...d.open_questions.map((text) => section({ kind: 'open_question', text })),
  ];
}

/** DESIGN_PROPOSAL → design sections (one per part) and modules (feature_ids → implements). */
export function adaptDesignProposal(out: DesignProposal): AdaptedOutput {
  const modules = out.modules.map((m): ItemDraft => ({
    ref: m.id, type: 'module', node: 'final', body: m, aiStance: recommend(DESIGN_REASON),
  }));
  return { drafts: [...designSections(out), ...modules], replace: scopes('final', 'design_section', 'module') };
}
