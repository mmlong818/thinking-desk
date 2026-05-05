'use client';

import { useEffect, useRef, useState } from 'react';
import { NodeFollowUpsRunner } from './NodeFollowUpsRunner';
import { useNodeFollowUps } from './useNodeFollowUps';
import { readCache, writeCache } from '@/lib/client-cache';
import { readPreferredModel } from '@/lib/client-model';
import type { FollowUpItem } from '@/lib/ai/follow-ups';

interface Props {
  projectSlug: string;
  nodeKind: string;
  /** 当前节点已产出的内容；为 null 时不触发派生。 */
  content: Record<string, unknown> | null | undefined;
  /** 已经在节点 content 上自带的 follow_ups（如 Brief 自带）。给了就跳过派生调用。 */
  presetFollowUps?: FollowUpItem[];
  /** 已经在 content 上自带的 follow_up_answers（如 Brief 自带）。 */
  presetAnswers?: Record<string, string>;
  /** 给 hook 用的"答案落回 content"回调（可选）。 */
  onMerge?: (
    content: Record<string, unknown>,
    field: string,
    answer: string,
  ) => Record<string, unknown>;
}

interface DerivedShape {
  follow_ups?: FollowUpItem[];
  follow_up_answers?: Record<string, string>;
}

export function NodeFollowUpsSection({
  projectSlug,
  nodeKind,
  content,
  presetFollowUps,
  presetAnswers,
  onMerge,
}: Props) {
  const [items, setItems] = useState<FollowUpItem[]>(presetFollowUps ?? []);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 同步 preset（Brief 走的路径）
  useEffect(() => {
    if (presetFollowUps) setItems(presetFollowUps);
  }, [presetFollowUps]);

  // 内容指纹（H8）—— 用 content 的 stable hash 替代 !!content；content 真正变化才触发重派生
  const contentFingerprint = content ? fingerprintContent(content) : null;
  // 上次跑过的 fingerprint（避免同一内容重复 fetch）
  const triedFingerprintRef = useRef<string | null>(null);

  // 自动派生：preset 没给 + content 已就绪 + 之前没用过同样 fingerprint → 调一次 API
  useEffect(() => {
    if (presetFollowUps) return;
    if (!content || !contentFingerprint) return;
    if (triedFingerprintRef.current === contentFingerprint) return;
    // 看 cache 里是否已存有派生结果
    const cached = readCache<{ derived_follow_ups?: FollowUpItem[] }>(projectSlug, `${nodeKind}-followups`);
    if (cached?.derived_follow_ups && cached.derived_follow_ups.length >= 0) {
      setItems(cached.derived_follow_ups);
      triedFingerprintRef.current = contentFingerprint;
      return;
    }
    triedFingerprintRef.current = contentFingerprint;
    setLoading(true);
    const preferred = readPreferredModel();
    fetch('/api/ai/derive-follow-ups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        nodeKind,
        content,
        ...(preferred ? { model: preferred } : {}),
      }),
    })
      .then(async (r) => {
        const j = (await r.json()) as {
          ok?: boolean;
          data?: { follow_ups: FollowUpItem[] };
          error?: string;
          detail?: string;
        };
        if (!r.ok || !j.ok || !j.data) throw new Error(j.detail ?? j.error ?? '派生失败');
        const derived = j.data.follow_ups;
        setItems(derived);
        writeCache(projectSlug, `${nodeKind}-followups`, { derived_follow_ups: derived });
      })
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug, nodeKind, contentFingerprint, presetFollowUps]);

  // 答案管理：preset 模式下完全交还给父组件控制（Brief）；其余情况用本地 hook 持久化
  const initialForHook = presetAnswers
    ? { follow_up_answers: presetAnswers }
    : (content as DerivedShape | null | undefined);
  const { answers, applyAnswer } = useNodeFollowUps(
    projectSlug,
    nodeKind,
    initialForHook as Record<string, unknown> | null | undefined,
    onMerge,
  );

  if (loading) {
    return (
      <div className="cop-runner cop-runner-loading">
        <div className="cop-runner-tag" style={{ marginBottom: 8 }}>追问 · 派生中</div>
        <div style={{ fontSize: 12, color: 'var(--ink-4)' }}>
          正在分析当前节点产出，挑出值得进一步澄清的关键缺失……
        </div>
      </div>
    );
  }
  if (err) {
    return (
      <div className="cop-runner" style={{ borderColor: 'var(--danger)' }}>
        <div className="cop-runner-tag" style={{ background: 'var(--warn-soft)', color: 'var(--danger)' }}>
          追问派生失败
        </div>
        <div style={{ fontSize: 12, color: 'var(--danger)', fontFamily: 'var(--mono)' }}>{err}</div>
      </div>
    );
  }
  if (items.length === 0) return null;

  return (
    <NodeFollowUpsRunner
      items={items}
      answers={answers}
      onAnswer={applyAnswer}
    />
  );
}

/**
 * 简易内容指纹：用 JSON.stringify 长度 + 顶层 key 数 + 末段 hash 当 fingerprint。
 * 不是密码学 hash，目的仅是"内容真的变了 → 字符串变化"，比 !!content 强得多。
 */
function fingerprintContent(c: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(c);
    const len = s.length;
    const tailHash = simpleHash(s.slice(-256));
    return `${len}-${Object.keys(c).length}-${tailHash}`;
  } catch {
    return 'unhashable';
  }
}

function simpleHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}
