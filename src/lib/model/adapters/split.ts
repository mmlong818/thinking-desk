import type { SubfeatureBreakdown } from '../../ai/schemas/split-subfeatures';
import type { ItemDraft } from '../repository';
import { modelStance, scopes, summaryDraft, type AdaptedOutput } from './common';

/**
 * SPLIT_SUBFEATURES → one `subtask` per subfeature, carrying its split's feature_id / module_id
 * (→ implements / derived_from Links), feature name and critical-path flag, with the model's own
 * verdict as aiStance (missing → neutral); plus the summary.
 */
export function adaptSubfeatureBreakdown(out: SubfeatureBreakdown): AdaptedOutput {
  const critical = new Set(out.critical_path);
  const subtasks = out.splits.flatMap((split) =>
    split.subfeatures.map(({ stance, ...sf }): ItemDraft => ({
      ref: sf.id,
      type: 'subtask',
      body: {
        ...sf,
        feature_id: split.feature_id,
        module_id: split.module_id,
        feature_name: split.feature_name,
        critical: critical.has(sf.id),
      },
      aiStance: modelStance(stance),
    })),
  );
  return {
    drafts: [...subtasks, ...summaryDraft('split', out.summary)],
    replace: scopes('split', 'subtask', 'summary'),
  };
}
