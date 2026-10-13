import { NODES, type NodeDef } from '@/data/nodes';
import { itemSummary } from '@/lib/model/feedback';
import type { Graph } from '@/lib/model/graph';
import type { Item } from '@/lib/model/item-types';
import { ITEM_TYPES } from '@/lib/model/types';
import { ITEM_TYPE_LABEL } from '@/components/shared/item-labels';

// Project export: the full graph as JSON (re-importable), or a readable Markdown digest of
// every node's items with the person's decisions. Richer PRD-style exports come in phase 3.

export const EXPORT_FORMAT = 'thinking-desk/graph';

export interface GraphExport {
  format: typeof EXPORT_FORMAT;
  version: 1;
  project: string;
  exportedAt: string;
  items: Item[];
  links: Graph['links'];
}

export function toGraphExport(project: string, graph: Graph, now = new Date()): GraphExport {
  return { format: EXPORT_FORMAT, version: 1, project, exportedAt: now.toISOString(), items: graph.items, links: graph.links };
}

const MARK: Record<Item['decision'], string> = { accepted: '✓', rejected: '✗', pending: '·' };
type ScalarField = 'problem_statement' | 'target_user' | 'scenario' | 'value_prop' | 'success_criteria' | 'time_constraint';
const FIELD_LABEL: Record<ScalarField, string> = {
  problem_statement: '问题陈述', target_user: '目标用户', scenario: '使用情景', value_prop: '价值主张',
  success_criteria: '成功标准', time_constraint: '时间约束',
};

function itemLine(i: Item): string {
  const stance = i.aiStance ? `（AI ${i.aiStance.verdict === 'recommend' ? '推荐' : i.aiStance.verdict === 'caution' ? '提醒谨慎' : '中立'}：${i.aiStance.reason}）` : '';
  const note = i.decision === 'rejected' && i.decisionNote ? ` —— 否决理由：${i.decisionNote}` : '';
  return `- ${MARK[i.decision]} ${itemSummary(i)}${stance}${note}`;
}

function renderBrief(brief: Extract<Item, { type: 'brief' }>): string[] {
  const b = brief.body;
  const out = [`**完整度**：${b.completeness}/100 · ${MARK[brief.decision]} ${brief.decision === 'accepted' ? '已采纳' : '未采纳'}`, ''];
  // "### 原始陈述" + quoted lines: the Markdown import reads the raw text back from this block.
  if (b.raw_text) out.push('### 原始陈述', '', `> ${b.raw_text.replace(/\n/g, '\n> ')}`, '');
  out.push('### 字段');
  for (const [k, label] of Object.entries(FIELD_LABEL) as [ScalarField, string][]) {
    out.push(`- **${label}**：${b.fields[k] ?? '—'}`);
  }
  out.push(`- **边界**：${b.fields.boundaries.length ? b.fields.boundaries.join(' · ') : '—'}`, '');
  if (b.answers.length) {
    out.push('### 澄清回答', ...b.answers.map((a) => `- **${a.question}** — ${Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer}`), '');
  }
  return out;
}

function renderNode(node: NodeDef, items: Item[]): string[] {
  const out = ['---', '', `## ${node.num} ${node.label} · ${node.sub}`, ''];
  const brief = items.find((i): i is Extract<Item, { type: 'brief' }> => i.type === 'brief');
  if (brief) out.push(...renderBrief(brief));
  for (const type of ITEM_TYPES) {
    if (type === 'brief') continue;
    const group = items.filter((i) => i.type === type);
    if (group.length === 0) continue;
    out.push(`### ${ITEM_TYPE_LABEL[type]}（${group.length}）`, ...group.map(itemLine), '');
  }
  return out;
}

/** ✓ accepted · ✗ rejected · "·" pending, with the AI's stance and the rejection note. */
export function toMarkdown(project: string, items: readonly Item[], now = new Date()): string {
  const lines = [`# ${project}`, '', `> 思考工作台导出 · ${now.toLocaleString('zh-CN')} · ✓ 已采纳 ✗ 已否决 · 待定`, ''];
  for (const node of NODES) {
    const nodeItems = items.filter((i) => i.node === node.kind && !i.deletedAt);
    if (nodeItems.length > 0) lines.push(...renderNode(node, nodeItems));
  }
  return lines.join('\n');
}
