'use client';

import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { ItemOfType } from '@/lib/model/context';
import { readUi, removeUi, UI_KEY, writeUi } from '@/lib/store/ui-cache';

const DRAFT_KEY = UI_KEY.briefDraft;

/**
 * The raw requirement text. Starts from the brief's raw_text, else from the draft typed before
 * the first analysis (kept in the UI cache so switching nodes or reloading loses nothing).
 */
export function useRawTextDraft(projectId: string, brief: ItemOfType<'brief'> | undefined, loading: boolean) {
  const [rawText, setRawText] = useState('');
  const initialised = useRef(false);

  useEffect(() => {
    if (loading || initialised.current) return;
    initialised.current = true;
    setRawText(brief?.body.raw_text ?? readUi(projectId, DRAFT_KEY, z.string()) ?? '');
  }, [loading, brief, projectId]);

  useEffect(() => {
    if (!initialised.current) return;
    if (brief) return removeUi(projectId, DRAFT_KEY);
    if (!rawText.trim()) return;
    const handle = setTimeout(() => writeUi(projectId, DRAFT_KEY, rawText), 400);
    return () => clearTimeout(handle);
  }, [rawText, brief, projectId]);

  return [rawText, setRawText] as const;
}

const IMPORT_KEY = UI_KEY.importNotice;

/** One-shot notice an import left for this project (read once, then removed). */
export function useImportNotice(projectId: string) {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const v = readUi(projectId, IMPORT_KEY, z.string());
    if (v) {
      setNotice(v);
      removeUi(projectId, IMPORT_KEY);
    }
  }, [projectId]);
  return [notice, () => setNotice(null)] as const;
}
