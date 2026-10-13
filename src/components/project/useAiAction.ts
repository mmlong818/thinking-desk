'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readPreferredModel } from '@/lib/client-model';
import { runAiAction, type AiActionOutcome, type AiActionSpec } from '@/lib/store/ai-action';
import type { StreamProgress } from '@/lib/store/stream-progress';
import { useProject } from './ProjectStore';
import { useStreamProgress } from './useStreamProgress';

// One AI action at a time per hook: calls the route with the picked model, saves the run and
// its adapted output, tracks which action is running and the last error. Leaving the page
// (or cancel()) aborts the request in flight. Streaming actions (`spec.stream`) also expose
// their live progress.

export interface AiActionState {
  /** Key of the action in flight, or null. */
  running: string | null;
  error: string | null;
  setError: (message: string | null) => void;
  /** Resolves with the outcome; failures also land in `error` (aborts do not). */
  run: <T>(key: string, spec: AiActionSpec<T>) => Promise<AiActionOutcome<T>>;
  /** Live progress of the streaming action in flight, else null. */
  progress: StreamProgress | null;
  /** Aborts the action in flight (and, server side, the provider call). */
  cancel: () => void;
}

export function useAiAction(): AiActionState {
  const { repo, store, reload } = useProject();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);
  const { progress, onEvent, reset } = useStreamProgress();

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const run = useCallback(async <T,>(key: string, spec: AiActionSpec<T>) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRunning(key);
    setError(null);
    reset();
    const model = readPreferredModel();
    // Progress of a superseded (aborted) action must not leak into the current one.
    const onProgress: typeof onEvent = (e) => ctrlRef.current === ctrl && onEvent(e);
    const deps = { fetch: (u: string, i?: RequestInit) => fetch(u, i), repo, projectId: store.projectId, signal: ctrl.signal, onProgress };
    try {
      const out = await runAiAction(deps, { ...spec, body: { ...spec.body, ...(model ? { model } : {}) } });
      if (!out.ok && !out.aborted) setError(out.message);
      return out;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      return { ok: false as const, aborted: false, message };
    } finally {
      if (ctrlRef.current === ctrl) {
        ctrlRef.current = null;
        setRunning(null);
        reset();
      }
      await reload();
    }
  }, [repo, store.projectId, reload, onEvent, reset]);

  const cancel = useCallback(() => ctrlRef.current?.abort(), []);
  return { running, error, setError, run, progress, cancel };
}
