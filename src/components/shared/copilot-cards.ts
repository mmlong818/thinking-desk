import type { CopilotCard } from '@/components/shell/Copilot';
import type { Item } from '@/lib/model/item-types';

type SummaryTopic = Extract<Item, { type: 'summary' }>['body']['topic'];

/** Critique items of a node as copilot cards (AI pushes back; never gates completion). */
export function critiqueCards(items: readonly Item[]): CopilotCard[] {
  return items.flatMap((i) =>
    i.type === 'critique' ? [{ tag: i.body.kind, title: i.body.title, body: i.body.body }] : [],
  );
}

/** Latest summary text of one topic on the node, or ''. */
export function summaryText(items: readonly Item[], topic: SummaryTopic): string {
  const hit = [...items].reverse().find((i) => i.type === 'summary' && i.body.topic === topic);
  return hit?.type === 'summary' ? hit.body.text : '';
}

export function summaryItem(items: readonly Item[], topic: SummaryTopic): Extract<Item, { type: 'summary' }> | undefined {
  const hit = [...items].reverse().find((i) => i.type === 'summary' && i.body.topic === topic);
  return hit?.type === 'summary' ? hit : undefined;
}
