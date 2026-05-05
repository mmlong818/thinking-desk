'use client';

import { useCallback, useRef, useState } from 'react';
import { readCache, writeCache } from '@/lib/client-cache';

/**
 * 通用 hook：每个节点用同一份"answers map + 写回 cache"逻辑。
 * 不强制 answer 写回结构化字段（节点各自结构不同），只负责本地持久化和返回 setter。
 *
 * 竞态保护（H7）：连点两次"记下答案"时，第一次的 cache write 还没在浏览器持久化前，
 * 第二次的 setAnswers updater 又会读 sessionStorage —— 拿到的是 stale 副本，
 * 写回时第一答案会丢。用 ref 缓存最新一次 merged content，updater 内部优先用 ref。
 */
export function useNodeFollowUps<TContent extends Record<string, unknown>>(
  projectSlug: string,
  nodeKind: string,
  initial: TContent | null | undefined,
  onMerge?: (content: TContent, field: string, answer: string) => TContent,
) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    (initial as { follow_up_answers?: Record<string, string> } | null | undefined)
      ?.follow_up_answers ?? {},
  );

  // 同步副本，每次 applyAnswer 写完都更新；下一次 updater 优先读它而不是 sessionStorage
  const latestCacheRef = useRef<TContent | null>(null);

  const applyAnswer = useCallback(
    (field: string, answer: string) => {
      setAnswers((prev) => {
        const next = { ...prev, [field]: answer };
        try {
          const cur = latestCacheRef.current ?? readCache<TContent>(projectSlug, nodeKind) ?? ({} as TContent);
          let merged: TContent = { ...cur, follow_up_answers: next } as TContent;
          if (onMerge && answer !== '〔跳过〕') {
            merged = onMerge(merged, field, answer);
          }
          latestCacheRef.current = merged;
          writeCache(projectSlug, nodeKind, merged);
        } catch {
          // ignore quota / json errors
        }
        return next;
      });
    },
    [projectSlug, nodeKind, onMerge],
  );

  return { answers, applyAnswer, setAnswers };
}
