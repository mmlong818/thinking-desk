import { NODES } from '@/data/nodes';
import { EXPORT_FORMAT } from '@/components/shell/export-format';

// Parsing an import file. JSON = the graph export (items + links), restored in full.
// Markdown = the readable export: only the brief's raw text comes back (as the brief draft).

export type ParsedImport =
  | { kind: 'graph'; name: string; items: unknown[]; links: unknown[] }
  | { kind: 'markdown'; name: string; rawText: string | null; downstream: number };

function parseJson(text: string, fileName: string): ParsedImport {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('文件不是合法的 JSON');
  }
  const obj = (typeof parsed === 'object' && parsed !== null ? parsed : {}) as Record<string, unknown>;
  if (obj.format === EXPORT_FORMAT && Array.isArray(obj.items) && Array.isArray(obj.links)) {
    const name = typeof obj.project === 'string' && obj.project.trim() ? obj.project.trim() : fileName.replace(/\.json$/i, '');
    return { kind: 'graph', name, items: obj.items, links: obj.links };
  }
  if ('nodes' in obj) throw new Error('这是旧版（按节点）导出格式，当前版本无法导入；请用 Markdown 恢复 Brief 原文，或在新版本里重新导出 JSON');
  throw new Error('JSON 不是思考工作台导出格式（缺少 items / links）');
}

function rawTextOf(text: string): string | null {
  const block = text.match(/###\s+原始陈述\s*\n+([\s\S]*?)(?=\n##\s|\n###\s|\n---\s*\n|$)/);
  if (!block) return null;
  const raw = block[1].split('\n').map((l) => l.replace(/^>\s?/, '')).filter((l) => l.length > 0).join('\n').trim();
  return raw || null;
}

function parseMarkdown(text: string, fileName: string): ParsedImport {
  const name = (text.match(/^#\s+(.+?)\s*$/m)?.[1] ?? fileName.replace(/\.md$/i, '')).trim();
  const sections = [...text.matchAll(/^##\s+0(\d)\s+/gm)].map((m) => NODES.find((n) => n.num === `0${m[1]}`)).filter(Boolean);
  const rawText = rawTextOf(text);
  if (!rawText && sections.length === 0) {
    throw new Error('Markdown 里没识别出任何节点内容（首行需要 # 项目名，至少有一个 ## 0X 节点）');
  }
  return { kind: 'markdown', name, rawText, downstream: sections.filter((n) => n?.kind !== 'brief').length };
}

export function parseImport(text: string, fileName: string): ParsedImport {
  const isMd = /\.md$/i.test(fileName) || /^#\s/m.test(text.trim().slice(0, 20));
  return isMd ? parseMarkdown(text, fileName) : parseJson(text, fileName);
}

/** The one-shot notice the brief page shows after a Markdown import. */
export function markdownNotice(p: Extract<ParsedImport, { kind: 'markdown' }>): string {
  if (!p.rawText) return 'Markdown 里未找到 `### 原始陈述` 区块，导入仅占位。完整恢复请用 JSON。';
  const rest = p.downstream > 0 ? `；${p.downstream} 个下游节点需重新分析` : '';
  return `Markdown 只恢复了 Brief 的原始陈述（已放进草稿，点"开始分析"即可）${rest}`;
}
