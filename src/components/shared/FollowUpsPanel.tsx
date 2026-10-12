'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { NodeKind } from '@/data/nodes';
import { FollowUpItemSchema, type FollowUpItem } from '@/lib/ai/follow-ups';
import { inputsOf } from '@/lib/model/context';
import type { Item } from '@/lib/model/item-types';
import { readUi, writeUi } from '@/lib/store/ui-cache';
import { useProject } from '@/components/project/ProjectStore';
import { useAiAction } from '@/components/project/useAiAction';
import { NodeFollowUpsRunner } from './NodeFollowUpsRunner';

// Copilot follow-up questions derived from a node's output (not items: regenerable prompts).
// Derived once per node and kept with their answers in the browser's UI cache.

const FollowUpsCache = z.object({
  items: z.array(FollowUpItemSchema),
  answers: z.record(z.string(), z.string()).default({}),
});
type FollowUps = z.output<typeof FollowUpsCache>;

function contentOf(items: readonly Item[]) {
  return { items: items.map((i) => ({ type: i.type, decision: i.decision, body: i.body })) };
}

export function FollowUpsPanel({ node, items }: { node: NodeKind; items: readonly Item[] }) {
  const { store } = useProject();
  const ai = useAiAction();
  const key = `followups:${node}`;
  const [state, setState] = useState<FollowUps | null>(null);
  const triedRef = useRef(false);
  const hasContent = items.length > 0;

  useEffect(() => {
    const cached = readUi(store.projectId, key, FollowUpsCache);
    if (cached) return setState(cached);
    if (!hasContent || triedRef.current) return;
    triedRef.current = true;
    void ai.run<{ follow_ups: FollowUpItem[] }>('derive', {
      route: '/api/ai/derive-follow-ups', body: { nodeKind: node, content: contentOf(items) }, node, inputs: inputsOf(items),
    }).then((res) => {
      if (!res.ok) return;
      const next = { items: res.data.follow_ups, answers: {} };
      writeUi(store.projectId, key, next);
      setState(next);
    });
    // Derive once per mount when content exists; later edits do not re-derive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.projectId, key, hasContent]);

  const applyAnswer = (field: string, answer: string) => {
    if (!state) return;
    const next = { ...state, answers: { ...state.answers, [field]: answer } };
    writeUi(store.projectId, key, next);
    setState(next);
  };

  if (ai.running) return <DerivingCard />;
  if (ai.error) return <DeriveError message={ai.error} />;
  if (!state || state.items.length === 0) return null;
  return <NodeFollowUpsRunner items={state.items} answers={state.answers} onAnswer={applyAnswer} />;
}

function DerivingCard() {
  return (
    <div className="cop-runner cop-runner-loading">
      <div className="cop-runner-tag" style={{ marginBottom: 8 }}>追问 · 派生中</div>
      <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>正在分析当前节点产出，挑出值得进一步澄清的关键缺失……</div>
    </div>
  );
}

function DeriveError({ message }: { message: string }) {
  return (
    <div className="cop-runner" style={{ borderColor: 'var(--danger)' }}>
      <div className="cop-runner-tag" style={{ background: 'var(--warn-soft)', color: 'var(--danger)' }}>追问派生失败</div>
      <div style={{ fontSize: 12, color: 'var(--danger)', fontFamily: 'var(--mono)' }}>{message}</div>
    </div>
  );
}
