'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addLocalProject, generateLocalSlug, listLocalProjects } from '@/lib/client-projects';
import { completedNodes } from '@/lib/model/completion';
import { LocalRepository, localProjectId } from '@/lib/model/local-repository';
import { importLocalProject } from '@/lib/model/local-transfer';
import { writeCompletionCookie } from '@/lib/store/completion-cookie';
import { UI_KEY, writeUi } from '@/lib/store/ui-cache';
import { markdownNotice, parseImport, type ParsedImport } from './import-bundle';

function newSlugFor(name: string): string {
  const existing = new Set(listLocalProjects().map((p) => p.slug));
  let slug = generateLocalSlug(name);
  for (let guard = 0; existing.has(slug) && guard < 5; guard++) slug = generateLocalSlug(name);
  return slug;
}

/** Writes the parsed file as a new local project; returns its slug. */
async function restore(parsed: ParsedImport): Promise<string> {
  const takenNames = listLocalProjects().some((p) => p.name === parsed.name);
  const name = takenNames ? `${parsed.name}（导入 ${new Date().toLocaleString('zh-CN', { hour12: false })}）` : parsed.name;
  const slug = newSlugFor(parsed.name);
  const projectId = localProjectId(slug);
  if (parsed.kind === 'graph') {
    const report = importLocalProject(window.localStorage, projectId, parsed);
    const { items } = await new LocalRepository().getGraph(projectId);
    writeCompletionCookie(slug, completedNodes(items));
    const dropped = report.droppedItems + report.droppedLinks;
    if (dropped > 0) writeUi(projectId, UI_KEY.importNotice, `导入时跳过了 ${dropped} 条无法识别的记录`);
  } else {
    if (parsed.rawText) writeUi(projectId, UI_KEY.briefDraft, parsed.rawText);
    writeUi(projectId, UI_KEY.importNotice, markdownNotice(parsed));
  }
  addLocalProject({ slug, name, summary: null });
  return slug;
}

export function ImportButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const handle = async (file: File) => {
    setErr(null);
    setBusy(true);
    try {
      const slug = await restore(parseImport(await file.text(), file.name));
      router.push(`/project/${encodeURIComponent(slug)}/brief`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        title="从之前导出的 JSON 或 Markdown 文件恢复一个项目"
      >
        {busy ? <><span className="ai-spinner" />&nbsp;导入中</> : '导入项目'}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json,.md,text/markdown"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void handle(f);
        }}
      />
      {err ? <ImportError message={err} onClose={() => setErr(null)} /> : null}
    </>
  );
}

function ImportError({ message, onClose }: { message: string; onClose: () => void }) {
  return (
    <div
      role="alert"
      style={{
        position: 'absolute', top: 'calc(100% + 6px)', right: 0, background: 'var(--paper)',
        border: '1px solid var(--danger)', color: 'var(--danger)', padding: '8px 12px', fontSize: 12,
        borderRadius: 5, maxWidth: 280, zIndex: 10,
      }}
    >
      导入失败：{message}
      <button type="button" onClick={onClose} style={{ marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
        ×
      </button>
    </div>
  );
}
