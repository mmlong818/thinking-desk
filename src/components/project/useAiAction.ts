'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readPreferredModel } from '@/lib/client-model';
import { runAiAction, type AiActionOutcome, type AiActionSpec } from '@/lib/store/ai-action';
import { useProject } from './ProjectStore';

// One AI action at a time per hook: calls the route with the picked model, saves the run and
// its adapted output, tracks which action is running and the last error. Leaving the page
// aborts the request in flight.

export interface AiActionState {
  /** Key of the action in flight, or null. */
  running: string | null;
  error: string | null;
  setError: (message: string | null) => void;
  /** Resolves with the outcome; failures also land in `error` (aborts do not). */
  run: <T>(key: string, spec: AiActionSpec<T>) => Promise<AiActionOutcome<T>>;
}

export function useAiAction(): AiActionState {
  const { repo, store, reload } = useProject();
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => () => ctrlRef.current?.abort(), []);

  const run = useCallback(async <T,>(key: string, spec: AiActionSpec<T>) => {
    ctrlRef.current?.abort();
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRunning(key);
    setError(null);
    const model = readPreferredModel();
    const deps = { fetch: (u: string, i?: RequestInit) => fetch(u, i), repo, projectId: store.projectId, signal: ctrl.signal };
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
      }
      await reload();
    }
  }, [repo, store.projectId, reload]);

  return { running, error, setError, run };
}
