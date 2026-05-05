'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { addLocalProject, generateLocalSlug, listLocalProjects } from '@/lib/client-projects';
import { writeCache } from '@/lib/client-cache';
import { NODES } from '@/data/nodes';

const VALID_KINDS = new Set([...NODES.map((n) => n.kind), 'design']);

interface ParsedBundle {
  project?: string;
  exportedAt?: string;
  nodes?: Record<string, unknown>;
}

export function ImportButton() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = () => inputRef.current?.click();

  const handle = async (file: File) => {
    setErr(null);
    setBusy(true);
    try {
      const text = await file.text();
      const isMd = /\.md$/i.test(file.name) || /^#\s/m.test(text.trim().slice(0, 20));
      const { name: baseName, nodes, warning } = isMd
        ? parseMarkdown(text, file.name)
        : parseJson(text, file.name);

      const knownKeys = Object.keys(nodes).filter((k) => VALID_KINDS.has(k));
      if (knownKeys.length === 0) {
        throw new Error(isMd
          ? 'Markdown 里没识别出任何节点内容（首行需要 # 项目名，至少有一个 ## 0X 节点）'
          : 'nodes 字段里没有可识别的节点（brief/users/...）');
      }

      const existing = new Set(listLocalProjects().map((p) => p.slug));
      let slug = generateLocalSlug(baseName);
      let guard = 0;
      while (existing.has(slug) && guard++ < 5) slug = generateLocalSlug(baseName);

      const finalName = listLocalProjects().some((p) => p.name === baseName)
        ? `${baseName}（导入 ${new Date().toLocaleString('zh-CN', { hour12: false })}）`
        : baseName;

      addLocalProject({ slug, name: finalName, summary: null });

      for (const k of knownKeys) {
        writeCache(slug, k, nodes[k]);
      }

      if (warning) {
        // 在跳转前留个非阻塞提示
        try { sessionStorage.setItem(`td:import-warn:${slug}`, warning); } catch { /* ignore */ }
      }

      router.push(`/project/${encodeURIComponent(slug)}/brief`);
      router.refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  // ---- parsers ----
  function parseJson(text: string, fileName: string): { name: string; nodes: Record<string, unknown>; warning?: string } {
    let parsed: ParsedBundle;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('文件不是合法的 JSON');
    }
    if (!parsed.nodes || typeof parsed.nodes !== 'object') {
      throw new Error('JSON 缺少 nodes 字段（应为思考工作台导出格式）');
    }
    return {
      name: (parsed.project && String(parsed.project).trim()) || fileName.replace(/\.json$/i, ''),
      nodes: parsed.nodes as Record<string, unknown>,
    };
  }

  function parseMarkdown(text: string, fileName: string): { name: string; nodes: Record<string, unknown>; warning: string } {
    const titleMatch = text.match(/^#\s+(.+?)\s*$/m);
    const name = (titleMatch?.[1] ?? fileName.replace(/\.md$/i, '')).trim();

    const nodes: Record<string, unknown> = {};
    // Brief 原始陈述：### 原始陈述\n\n> {line1}\n> {line2}...
    const briefRawBlock = text.match(/###\s+原始陈述\s*\n+([\s\S]*?)(?=\n##\s|\n###\s|\n---\s*\n|$)/);
    if (briefRawBlock) {
      const rawLines = briefRawBlock[1]
        .split('\n')
        .map((l) => l.replace(/^>\s?/, ''))
        .filter((l) => l.length > 0);
      const raw = rawLines.join('\n').trim();
      if (raw) {
        nodes['brief'] = {
          raw_text: raw,
          highlights: [],
          fields: {
            problem_statement: null, target_user: null, scenario: null, value_prop: null,
            success_criteria: null, time_constraint: null, boundaries: [], red_lines: [],
          },
          follow_ups: [],
          completeness: 0,
          answers: [],
        };
      }
    }

    // 其他节点：扫描 ## 0X 标题，把节文本作为 raw_md 占位（节点组件不会原生消费 raw_md，
    // 但这样能让节点显示"还有内容但需要重新分析"——主要价值是触发 cookie 解锁让用户继续走）
    const sectionRegex = /^##\s+0(\d)\s+([^\n]+?)$/gm;
    let m: RegExpExecArray | null;
    const headers: { num: string; pos: number; end: number }[] = [];
    while ((m = sectionRegex.exec(text)) !== null) {
      headers.push({ num: m[1], pos: m.index, end: sectionRegex.lastIndex });
    }
    for (let i = 0; i < headers.length; i++) {
      const h = headers[i];
      const next = headers[i + 1]?.pos ?? text.length;
      const body = text.slice(h.end, next).trim();
      const node = NODES.find((n) => n.num === `0${h.num}`);
      if (!node || node.kind === 'brief') continue;
      // 只有 brief 能从 MD 完整恢复；其他节点只把 markdown 留作 raw_md 占位
      if (body.length > 20 && !nodes[node.kind]) {
        nodes[node.kind] = { _imported_md: body };
      }
    }

    const recovered = Object.keys(nodes).filter((k) => k !== 'brief').length;
    const briefOk = !!nodes['brief'];
    const warning = briefOk
      ? `Markdown 只恢复了 Brief 的原始陈述${recovered > 0 ? `；${recovered} 个下游节点保留了原文，但需重新分析才能进入交互态` : ''}`
      : `Markdown 里未找到 \`### 原始陈述\` 区块，导入仅占位。完整恢复请用 JSON。`;

    return { name, nodes, warning };
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={pick}
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
          if (f) handle(f);
        }}
      />
      {err ? (
        <div
          role="alert"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            background: 'var(--paper)',
            border: '1px solid var(--danger)',
            color: 'var(--danger)',
            padding: '8px 12px',
            fontSize: 12,
            borderRadius: 5,
            maxWidth: 280,
            zIndex: 10,
          }}
        >
          导入失败：{err}
          <button
            type="button"
            onClick={() => setErr(null)}
            style={{ marginLeft: 8, background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            ×
          </button>
        </div>
      ) : null}
    </>
  );
}
