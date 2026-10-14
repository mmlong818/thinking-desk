'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeKind } from '@/data/nodes';
import type { FollowUpItem } from '@/lib/ai/follow-ups';
import { inputsOf } from '@/lib/model/context';
import type { Item } from '@/lib/model/item-types';
import {
  failureRecord, FollowUpsCacheSchema, FollowUpsFailureSchema, planFollowUps, type FollowUpsCache,
} from '@/lib/store/follow-ups-state';
import { readUi, removeUi, UI_KEY, writeUi } from '@/lib/store/ui-cache';
import { useProject } from '@/components/project/ProjectStore';
import { useAiAction } from '@/components/project/useAiAction';
import { NodeFollowUpsRunner } from './NodeFollowUpsRunner';

// Copilot follow-up questions derived from a node's output (not items: regenerable prompts).
// Derived once per node and kept with their answers in the browser's UI cache. A failed
// derivation is remembered for the node's current inputs and offered as a manual retry instead
// of calling the AI again on every visit (src/lib/store/follow-ups-state.ts).

function contentOf(items: readonly Item[]) {
  return { items: items.map((i) => ({ type: i.type, decision: i.decision, body: i.body })) };
}

function useFollowUps(node: NodeKind, items: readonly Item[]) {
  const { store } = useProject();
  const { projectId } = store;
  const { run, running } = useAiAction();
  const [cache, setCache] = useState<FollowUpsCache | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const startedRef = useRef(false);
  const inputs = useMemo(() => inputsOf(items), [items]);

  const derive = useCallback(async () => {
    setFailed(null);
    removeUi(projectId, UI_KEY.followUpsFailure(node));
    const res = await run<{ follow_ups: FollowUpItem[] }>('derive', {
      route: '/api/ai/derive-follow-ups', body: { nodeKind: node, content: contentOf(items) }, node, inputs,
    });
    if (res.ok) {
      const next = { items: res.data.follow_ups, answers: {} };
      writeUi(projectId, UI_KEY.followUps(node), next);
      setCache(next);
    } else if (!res.aborted) {
      writeUi(projectId, UI_KEY.followUpsFailure(node), failureRecord(inputs, res.message));
      setFailed(res.message);
    }
  }, [run, projectId, node, items, inputs]);

  useEffect(() => {
    const plan = planFollowUps({
      cache: readUi(projectId, UI_KEY.followUps(node), FollowUpsCacheSchema),
      failure: readUi(projectId, UI_KEY.followUpsFailure(node), FollowUpsFailureSchema),
      inputs,
    });
    if (plan.kind === 'show') setCache(plan.cache);
    if (plan.kind === 'failed') setFailed(plan.message);
    if (plan.kind !== 'derive' || startedRef.current) return;
    startedRef.current = true;
    void derive();
    // An unmount aborts the call (useAiAction), so a remount - StrictMode's in dev, too - must derive again.
    return () => { startedRef.current = false; };
    // Planned once per mount when content exists; later edits do not re-derive.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, node, inputs.length > 0]);

  const answer = (field: string, value: string) => {
    if (!cache) return;
    const next = { ...cache, answers: { ...cache.answers, [field]: value } };
    writeUi(projectId, UI_KEY.followUps(node), next);
    setCache(next);
  };
  return { cache, failed, running: running !== null, retry: () => void derive(), answer };
}

export function FollowUpsPanel({ node, items }: { node: NodeKind; items: readonly Item[] }) {
  const f = useFollowUps(node, items);
  if (f.running) return <DerivingCard />;
  if (f.failed) return <DeriveError message={f.failed} onRetry={f.retry} />;
  if (!f.cache || f.cache.items.length === 0) return null;
  return <NodeFollowUpsRunner items={f.cache.items} answers={f.cache.answers} onAnswer={f.answer} />;
}

function DerivingCard() {
  return (
    <div className="cop-runner cop-runner-loading">
      <div className="cop-runner-tag" style={{ marginBottom: 8 }}>追问 · 派生中</div>
      <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>正在分析当前节点产出，挑出值得进一步澄清的关键缺失……</div>
    </div>
  );
}

function DeriveError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="cop-runner" style={{ borderColor: 'var(--danger)' }}>
      <div className="cop-runner-tag" style={{ background: 'var(--warn-soft)', color: 'var(--danger)' }}>追问派生失败</div>
      <div style={{ fontSize: 12, color: 'var(--danger)', fontFamily: 'var(--mono)' }}>{message}</div>
      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>不会自动重试；本节点产出变化后会重新派生。</div>
      <button type="button" className="btn btn-ghost btn-xs" style={{ marginTop: 8 }} onClick={onRetry}>重试派生</button>
    </div>
  );
}
