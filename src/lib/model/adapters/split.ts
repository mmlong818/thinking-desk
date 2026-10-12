import type { SubfeatureBreakdown } from '../../ai/schemas/split-subfeatures';
import type { ItemDraft } from '../repository';
import { recommend, scopes, summaryDraft, type AdaptedOutput } from './common';

export const SUBTASK_REASON = {
  critical: '关键路径上的子任务',
  normal: '可执行子任务',
} as const;

/**
 * SPLIT_SUBFEATURES → one `subtask` per subfeature, carrying its split's feature_id / module_id
 * (→ implements / derived_from Links), feature name and critical-path flag; plus the summary.
 */
export function adaptSubfeatureBreakdown(out: SubfeatureBreakdown): AdaptedOutput {
  const critical = new Set(out.critical_path);
  const subtasks = out.splits.flatMap((split) =>
    split.subfeatures.map((sf): ItemDraft => ({
      ref: sf.id,
      type: 'subtask',
      body: {
        ...sf,
        feature_id: split.feature_id,
        module_id: split.module_id,
        feature_name: split.feature_name,
        critical: critical.has(sf.id),
      },
      aiStance: recommend(critical.has(sf.id) ? SUBTASK_REASON.critical : SUBTASK_REASON.normal),
    })),
  );
  return {
    drafts: [...subtasks, ...summaryDraft('split', out.summary)],
    replace: scopes('split', 'subtask', 'summary'),
  };
}
