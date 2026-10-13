import type { ItemOfType } from '../model/context';
import { indexById, liveGraph, type Graph } from '../model/graph';
import type { Item } from '../model/item-types';
import { toCsv } from './csv';

// Task export files from the accepted subtasks (deterministic, files only — nothing is pushed to
// an external service). One normalised row per subtask, ordered so that every dependency comes
// first, then three formats; docs/exports.md says how to import each and what was verified.

type Subtask = ItemOfType<'subtask'>;

export interface TaskRow {
  /** Stable key within one export: T-1, T-2, … in dependency order. */
  key: string;
  /** The subtask's permanent id. */
  id: string;
  title: string;
  description: string;
  layer: string;
  estimate: string;
  /** Hours from the estimate ("0.5d" → 4, "1w" → 40, "6h" → 6); null when it cannot be read. */
  hours: number | null;
  acceptance: string[];
  critical: boolean;
  feature: string;
  module: string;
  /** Keys of exported subtasks this one depends on (must be done first). */
  dependsOn: string[];
  /** Dependencies that are not exported (not accepted). */
  otherDependencies: number;
}

const HOURS: Record<string, number> = { h: 1, 小时: 1, d: 8, 天: 8, w: 40, 周: 40 };

/** "0.5d" / "2 天" / "1w" / "4h" → hours (8 h a day, 5 days a week; a bare number is days); null when unreadable. */
export function estimateHours(estimate: string): number | null {
  const m = estimate.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(h|d|w|小时|天|周)?$/);
  return m ? Number(m[1]) * HOURS[m[2] ?? 'd'] : null;
}

const nameOf = (i: Item | undefined): string => {
  const body = i?.body as { name?: unknown } | undefined;
  return typeof body?.name === 'string' ? body.name : '';
};

/** Kahn's order over depends_on (cycles cannot be stored, but stay safe), stable by original order. */
function dependencyOrder(subtasks: Subtask[], deps: Map<string, string[]>): Subtask[] {
  const done = new Set<string>();
  const out: Subtask[] = [];
  let pending = subtasks;
  while (pending.length > 0) {
    const ready = pending.filter((s) => (deps.get(s.id) ?? []).every((d) => done.has(d)));
    const batch = ready.length > 0 ? [ready[0]] : [pending[0]];
    for (const s of batch) {
      done.add(s.id);
      out.push(s);
    }
    pending = pending.filter((s) => !done.has(s.id));
  }
  return out;
}

export function taskRows(graph: Graph): TaskRow[] {
  const live = liveGraph(graph.items, graph.links);
  const byId = indexById(live.items);
  const subtasks = live.items.filter((i): i is Subtask => i.type === 'subtask' && i.decision === 'accepted');
  const exported = new Set(subtasks.map((s) => s.id));
  const target = (id: string, rel: string, type: string) => live.links
    .filter((l) => l.from === id && l.rel === rel).map((l) => byId.get(l.to)).find((i) => i?.type === type);
  const allDeps = new Map(subtasks.map((s) => [s.id, live.links.filter((l) => l.from === s.id && l.rel === 'depends_on').map((l) => l.to)]));
  const deps = new Map([...allDeps].map(([id, ds]) => [id, ds.filter((d) => exported.has(d))]));
  const ordered = dependencyOrder(subtasks, deps);
  const keyOf = new Map(ordered.map((s, i) => [s.id, `T-${i + 1}`]));
  return ordered.map((s) => ({
    key: keyOf.get(s.id) ?? '', id: s.id, title: s.body.title, description: s.body.description, layer: s.body.layer,
    estimate: s.body.estimate, hours: estimateHours(s.body.estimate), acceptance: s.body.acceptance_criteria,
    critical: s.body.critical,
    feature: nameOf(target(s.id, 'implements', 'feature')) || s.body.feature_name || '',
    module: nameOf(target(s.id, 'derived_from', 'module')),
    dependsOn: (deps.get(s.id) ?? []).map((d) => keyOf.get(d) ?? d),
    otherDependencies: (allDeps.get(s.id)?.length ?? 0) - (deps.get(s.id)?.length ?? 0),
  }));
}

const titleOf = (rows: TaskRow[]) => new Map(rows.map((r) => [r.key, r.title]));

/** Plain-text description shared by every format: what, acceptance criteria, context, dependencies. */
export function taskDescription(row: TaskRow, rows: TaskRow[]): string {
  const titles = titleOf(rows);
  const lines = [row.description.trim()];
  if (row.acceptance.length > 0) lines.push('', '验收标准：', ...row.acceptance.map((a) => `- ${a}`));
  const meta = [row.feature && `功能：${row.feature}`, row.module && `模块：${row.module}`, `层：${row.layer}`, row.estimate && `估时：${row.estimate}`];
  lines.push('', meta.filter(Boolean).join(' · '));
  if (row.dependsOn.length > 0) lines.push(`依赖：${row.dependsOn.map((k) => `${k} ${titles.get(k) ?? ''}`.trim()).join('；')}`);
  if (row.otherDependencies > 0) lines.push(`另依赖 ${row.otherDependencies} 条未导出（未采纳）的子任务`);
  lines.push(`来源：思考工作台 ${row.key} · ${row.id}${row.critical ? ' · 关键路径' : ''}`);
  return lines.join('\n');
}

const labelsOf = (row: TaskRow) => [`layer-${row.layer}`, ...(row.critical ? ['critical-path'] : []), 'thinking-desk'];

/**
 * Jira Cloud "Import work items from a CSV file". Labels repeat their column (one value per cell);
 * Original Estimate is in seconds; "Blocks" columns hold the Work item IDs this row blocks (map them
 * to the Blocks link type in the wizard), i.e. A depends on B ⇒ row B blocks A.
 */
export function toJiraCsv(rows: TaskRow[]): string {
  const blocks = new Map(rows.map((r) => [r.key, rows.filter((o) => o.dependsOn.includes(r.key)).map((o) => o.key)]));
  const labelCols = Math.max(1, ...rows.map((r) => labelsOf(r).length));
  const blockCols = Math.max(1, ...rows.map((r) => blocks.get(r.key)?.length ?? 0));
  const idOf = (key: string) => key.replace('T-', '');
  const header = ['Work item ID', 'Summary', 'Description', 'Work type', 'Priority', ...Array(labelCols).fill('Labels'),
    'Original Estimate', ...Array(blockCols).fill('Blocks')];
  const body = rows.map((r) => {
    const labels = labelsOf(r);
    const blocked = (blocks.get(r.key) ?? []).map(idOf);
    return [
      idOf(r.key), r.title, taskDescription(r, rows), 'Task', r.critical ? 'High' : 'Medium',
      ...Array.from({ length: labelCols }, (_, i) => labels[i] ?? ''),
      r.hours === null ? '' : Math.round(r.hours * 3600),
      ...Array.from({ length: blockCols }, (_, i) => blocked[i] ?? ''),
    ];
  });
  return toCsv([header, ...body]);
}

/**
 * Linear's own CSV format, imported with the `@linear/import` CLI ("Linear" CSV). That format has
 * no relation columns, so dependencies stay in the description; labels are one comma-separated
 * cell; Priority / Status / Estimate are left empty (their accepted values are not documented).
 */
export function toLinearCsv(rows: TaskRow[]): string {
  const header = ['Title', 'Description', 'Priority', 'Status', 'Assignee', 'Created', 'Completed', 'Labels', 'Estimate'];
  const body = rows.map((r) => [r.title, taskDescription(r, rows), '', '', '', '', '', labelsOf(r).join(','), '']);
  return toCsv([header, ...body]);
}

export const GITHUB_EXPORT_FORMAT = 'thinking-desk/github-issues';

const LABEL_COLORS: Record<string, string> = { 'critical-path': 'b84a2b', 'thinking-desk': '3b5a4a' };

/**
 * GitHub: labels to create first (`gh label create --force`), then one REST "create an issue"
 * payload per subtask in dependency order (`gh api repos/OWNER/REPO/issues --input -`).
 * docs/exports.md has the two-line import.
 */
export function toGithubIssues(rows: TaskRow[]) {
  const labels = [...new Set(rows.flatMap(labelsOf))].sort().map((name) => ({
    name, color: LABEL_COLORS[name] ?? 'c9c2b8', description: name.startsWith('layer-') ? `子任务层：${name.slice(6)}` : '思考工作台导出',
  }));
  return {
    format: GITHUB_EXPORT_FORMAT,
    version: 1,
    labels,
    issues: rows.map((r) => ({
      key: r.key, source_id: r.id, depends_on: r.dependsOn,
      title: r.title, body: taskDescription(r, rows), labels: labelsOf(r),
    })),
  };
}
