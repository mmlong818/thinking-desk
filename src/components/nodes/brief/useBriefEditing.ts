'use client';

import { useEffect, useRef } from 'react';
import { useItemActions } from '@/components/project/useItemActions';
import type { ItemOfType } from '@/lib/model/context';
import type { ItemBody } from '@/lib/model/item-types';
import { SCALAR_FIELDS, SKIPPED, type ScalarFieldKey } from './brief-meta';

type BriefBody = ItemBody<'brief'>;
type Fields = BriefBody['fields'];

const splitAnswer = (answer: string) => answer.split('；').map((x) => x.trim()).filter(Boolean);
const isScalar = (field: string): field is ScalarFieldKey => (SCALAR_FIELDS as string[]).includes(field);

/** A copilot follow-up answer lands in the brief body (as the old cache merge did). */
function mergeAnswer(b: BriefBody, field: string, answer: string): BriefBody {
  const withAnswer = { ...b, follow_up_answers: { ...b.follow_up_answers, [field]: answer } };
  if (answer === SKIPPED) return withAnswer;
  if (field === 'boundaries') {
    const boundaries = Array.from(new Set([...b.fields.boundaries, ...splitAnswer(answer)]));
    return { ...withAnswer, fields: { ...b.fields, boundaries } };
  }
  if (!isScalar(field)) return withAnswer;
  const cur = b.fields[field];
  return { ...withAnswer, fields: { ...b.fields, [field]: cur && cur.trim() ? `${cur}；${answer}` : answer } };
}

/**
 * Human edits of the brief singleton. Edits build on the latest body seen (a ref), so two quick
 * follow-up answers do not overwrite each other before the store reloads.
 */
export function useBriefEditing(brief: ItemOfType<'brief'> | undefined, redLines: ItemOfType<'red_line'>[]) {
  const actions = useItemActions();
  const bodyRef = useRef<BriefBody | undefined>(brief?.body);
  useEffect(() => {
    bodyRef.current = brief?.body;
  }, [brief]);

  const patchBody = (mutate: (b: BriefBody) => BriefBody) => {
    if (!brief || !bodyRef.current) return;
    const next = mutate(bodyRef.current);
    bodyRef.current = next;
    void actions.editBody(brief, next);
  };

  const addRedLine = (text: string) => {
    const t = text.trim();
    if (!t || redLines.some((r) => r.body.text === t && r.decision !== 'rejected')) return;
    void actions.create({ node: 'brief', type: 'red_line', body: { text: t } });
  };

  return {
    error: actions.error,
    patchFields: (patch: Partial<Fields>) => patchBody((b) => ({ ...b, fields: { ...b.fields, ...patch } })),
    addRedLine,
    applyFollowUp: (field: string, answer: string) => {
      patchBody((b) => mergeAnswer(b, field, answer));
      if (field === 'red_lines' && answer !== SKIPPED) splitAnswer(answer).forEach(addRedLine);
    },
  };
}
