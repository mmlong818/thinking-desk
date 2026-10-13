'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TaskProgress } from '@/lib/ai/stream-protocol';
import { applyProgress, type StreamProgress } from '@/lib/store/stream-progress';

// Progress of a streamed AI action as React state. Deltas can arrive many times a second, so
// they are folded into a ref and rendered at most every `intervalMs`; a new attempt renders at once.

export function useStreamProgress(intervalMs = 150) {
  const [progress, setProgress] = useState<StreamProgress | null>(null);
  const latest = useRef<StreamProgress | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  const onEvent = useCallback((event: TaskProgress) => {
    latest.current = applyProgress(latest.current, event, Date.now());
    if (event.type === 'attempt') {
      stopTimer();
      setProgress(latest.current);
    } else if (!timer.current) {
      timer.current = setTimeout(() => {
        timer.current = null;
        setProgress(latest.current);
      }, intervalMs);
    }
  }, [intervalMs]);

  const reset = useCallback(() => {
    stopTimer();
    latest.current = null;
    setProgress(null);
  }, []);

  useEffect(() => stopTimer, []);
  return { progress, onEvent, reset };
}
