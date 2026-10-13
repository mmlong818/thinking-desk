'use client';

import { useItemActions } from '@/components/project/useItemActions';
import { BLANK, type SectionItem, type SectionKind } from './design-meta';

/**
 * Edits of design entries. Every entry is a design_section item: edits patch its body, "+ 添加"
 * creates the person's own (accepted) entry, × deletes a hand-made entry (AI entries are rejected
 * through their decision control instead, so the judgment is kept).
 */
export function useDesignEdit() {
  const actions = useItemActions();
  return {
    error: actions.error,
    busy: actions.busy !== null,
    patch: (item: SectionItem, patch: Record<string, unknown>) => void actions.editBody(item, { ...item.body, ...patch }),
    add: (kind: SectionKind) => {
      const body = BLANK[kind];
      if (body) void actions.create({ node: 'final', type: 'design_section', body });
    },
    remove: (item: SectionItem) => void actions.remove(item),
  };
}

export type DesignEdit = ReturnType<typeof useDesignEdit>;
