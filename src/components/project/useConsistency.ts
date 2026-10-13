'use client';

import { useMemo } from 'react';
import type { NodeKind } from '@/data/nodes';
import type { ConsistencyCheck } from '@/lib/ai/schemas/consistency-check';
import { adaptConsistencyCheck, CONSISTENCY_SCOPES } from '@/lib/model/adapters';
import { ruleFindings, type RuleFinding } from '@/lib/model/consistency';
import { consistencyInput } from '@/lib/model/consistency-context';
import { inputsOf } from '@/lib/model/context';
import { buildFeedback } from '@/lib/model/feedback';
import { indexById, liveGraph } from '@/lib/model/graph';
import type { Item } from '@/lib/model/item-types';
import type { Run } from '@/lib/model/types';
import { useProject } from './ProjectStore';
import { useAiAction } from './useAiAction';

export type FindingItem = Extract<Item, { type: 'finding' }>;

export interface ConsistencyState {
  /** Rule layer: recomputed on every graph change, no AI. */
  rules: RuleFinding[];
  /** AI layer: finding items (any decision), newest check first in the store's order. */
  findings: FindingItem[];
  byId: Map<string, Item>;
  /** The items a finding is about (its conflicts_with Links). */
  involved: (finding: FindingItem) => Item[];
  lastRun?: Run;
}

export function useConsistency(): ConsistencyState {
  const { snapshot } = useProject();
  return useMemo(() => {
    const graph = liveGraph(snapshot?.items ?? [], snapshot?.links ?? []);
    const byId = indexById(graph.items);
    const involved = (f: FindingItem) => graph.links
      .filter((l) => l.from === f.id && l.rel === 'conflicts_with')
      .map((l) => byId.get(l.to))
      .filter((i): i is Item => !!i);
    return {
      rules: ruleFindings(graph),
      findings: graph.items.filter((i): i is FindingItem => i.type === 'finding'),
      byId,
      involved,
      lastRun: snapshot?.runs.find((r) => r.task === 'CONSISTENCY_CHECK'),
    };
  }, [snapshot]);
}

/**
 * The manual AI check ("调用一次 AI"): digests of the downstream context of every node go to
 * /api/ai/consistency-check; judged findings of earlier checks go along as feedback. The run is
 * recorded on the page it was started from; findings land on the most downstream node they cite.
 */
export function useConsistencyCheck(node: NodeKind) {
  const { slug, snapshot } = useProject();
  const ai = useAiAction();
  const run = () => {
    const items = (snapshot?.items ?? []).filter((i) => !i.deletedAt);
    const links = snapshot?.links ?? [];
    const input = consistencyInput(items, links);
    if (input.items.length === 0) return ai.setError('还没有可检查的条目：先在各节点产出并采纳一些内容');
    void ai.run<ConsistencyCheck>('consistency', {
      route: '/api/ai/consistency-check',
      body: { projectSlug: slug, items: input.items, feedback: buildFeedback(items, CONSISTENCY_SCOPES, links) },
      node,
      inputs: inputsOf(input.sources),
      adapt: (out) => adaptConsistencyCheck(out, { nodeOf: input.nodeOf, runNode: node }),
    });
  };
  return { run, running: ai.running !== null, error: ai.error, cancel: ai.cancel };
}
