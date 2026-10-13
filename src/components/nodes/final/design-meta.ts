import type { ItemOfType } from '@/lib/model/context';
import type { ItemBody } from '@/lib/model/item-types';

export type SectionItem = ItemOfType<'design_section'>;
export type ModuleItem = ItemOfType<'module'>;
export type SectionBody = ItemBody<'design_section'>;
export type SectionKind = SectionBody['kind'];
export type SectionOf<K extends SectionKind> = SectionItem & { body: Extract<SectionBody, { kind: K }> };

export function sectionsOf<K extends SectionKind>(sections: readonly SectionItem[], kind: K): SectionOf<K>[] {
  return sections.filter((s): s is SectionOf<K> => s.body.kind === kind);
}

/** Bodies a person starts a new design entry from ("+ 添加我的…"). */
export const BLANK: { [K in SectionKind]?: Extract<SectionBody, { kind: K }> } = {
  ia: { kind: 'ia', title: '', body: '' },
  interaction: { kind: 'interaction', title: '', body: '' },
  tech: { kind: 'tech', title: '', body: '' },
  metric: { kind: 'metric', name: '', definition: '', target: '' },
  risk: { kind: 'risk', risk: '', mitigation: '' },
  milestone: { kind: 'milestone', phase: '', goal: '', deliverables: [], duration: '' },
  open_question: { kind: 'open_question', text: '' },
  data_entity: { kind: 'data_entity', name: '', description: '', fields: [{ name: '', type: '', note: '' }] },
  flow: {
    kind: 'flow', name: '', goal: '', precondition: '', success_criteria: '', failure_handling: '',
    steps: [
      { step: 1, actor: '', action: '', system_response: '' },
      { step: 2, actor: '', action: '', system_response: '' },
    ],
  },
};
