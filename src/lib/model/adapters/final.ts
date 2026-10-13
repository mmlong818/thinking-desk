import type { Feature } from '../../ai/schemas/draft-features';
import type { DesignProposal } from '../../ai/schemas/generate-design';
import type { FeatureRevision } from '../../ai/schemas/revise-features';
import type { ItemStance } from '../../ai/schemas/stance';
import type { DraftLink, ItemDraft } from '../repository';
import { critiqueDrafts, modelStance, scopes, summaryDraft, type AdaptedOutput } from './common';
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

/** One design part; its aiStance is the model's own verdict on that part (missing → neutral). */
function section(body: Record<string, unknown>, stance: ItemStance | undefined): ItemDraft {
  return { type: 'design_section', node: 'final', body, aiStance: modelStance(stance) };
}

function titled(kind: 'ia' | 'interaction' | 'tech', list: DesignProposal['information_architecture']): ItemDraft[] {
  return list.map(({ title, body, stance }) => section({ kind, title, body }, stance));
}

function designSections(d: DesignProposal): ItemDraft[] {
  return [
    section({ kind: 'overview', title: d.title, one_liner: d.one_liner, vision: d.vision }, d.overview_stance),
    section({ kind: 'principles', items: d.design_principles }, d.principles_stance),
    ...titled('ia', d.information_architecture),
    ...d.user_flows.map(({ id: _id, stance, ...flow }) => section({ kind: 'flow', ...flow }, stance)),
    ...titled('interaction', d.key_interactions),
    ...d.data_model.map(({ stance, ...e }) => section({ kind: 'data_entity', ...e }, stance)),
    ...titled('tech', d.tech_skeleton),
    ...d.metrics.map(({ stance, ...m }) => section({ kind: 'metric', ...m }, stance)),
    ...d.risks.map(({ stance, ...r }) => section({ kind: 'risk', ...r }, stance)),
    ...d.milestones.map(({ stance, ...m }) => section({ kind: 'milestone', ...m }, stance)),
    ...d.open_questions.map(({ question, stance }) => section({ kind: 'open_question', text: question }, stance)),
  ];
}

/** DESIGN_PROPOSAL → design sections (one per part) and modules (feature_ids → implements). */
export function adaptDesignProposal(out: DesignProposal): AdaptedOutput {
  const modules = out.modules.map(({ stance, ...m }): ItemDraft => ({
    ref: m.id, type: 'module', node: 'final', body: m, aiStance: modelStance(stance),
  }));
  return { drafts: [...designSections(out), ...modules], replace: scopes('final', 'design_section', 'module') };
}
