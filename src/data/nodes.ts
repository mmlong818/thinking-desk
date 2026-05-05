export type NodeKind =
  | 'brief' | 'users' | 'stake' | 'alt'
  | 'scen' | 'feat' | 'leap' | 'final' | 'split';

export interface NodeDef {
  kind: NodeKind;
  num: string;
  label: string;
  sub: string;
  section: string;
  chip: string;
  /** 上游依赖：这些节点未完成则当前节点锁定 */
  deps: readonly NodeKind[];
}

export const NODES: readonly NodeDef[] = [
  { kind: 'brief',  num: '01', label: 'Brief',         sub: '把问题说清楚',          section: '一、问题定义',   chip: '对话式补全 · 预计 15 分钟', deps: [] },
  { kind: 'users',  num: '02', label: '用户与任务',    sub: 'Job-to-be-done',         section: '二、四维分析',   chip: 'JTBD · 预计 25 分钟',        deps: ['brief'] },
  { kind: 'stake',  num: '03', label: '干系人',        sub: 'Mendelow 矩阵',          section: '二、四维分析',   chip: 'Mendelow 矩阵 · 预计 20 分钟', deps: ['brief'] },
  { kind: 'alt',    num: '04', label: '替代方案',      sub: '直接 / 间接 / 非消费',   section: '二、四维分析',   chip: '替代方案扫描 · 预计 25 分钟', deps: ['brief'] },
  { kind: 'scen',   num: '05', label: '情景',          sub: '六维 × 故事板',          section: '二、四维分析',   chip: '进料加速 · 预计 30 分钟',     deps: ['brief'] },
  { kind: 'feat',   num: '06', label: '功能列表',      sub: '市场常规方案 · 还未设计', section: '三、常规方案',   chip: '能力罗列 · 预计 45 分钟',     deps: ['brief'] },
  { kind: 'leap',   num: '07', label: '创造性跃迁',    sub: '★ 设计真正开始的地方',   section: '四、开始设计',   chip: '差异化诞生 · 预计 45 分钟',   deps: ['feat'] },
  { kind: 'final',  num: '08', label: '设计案',        sub: '从功能 → 完整设计文档',   section: '四、开始设计',   chip: '完整设计输出 · 预计 30 分钟', deps: ['feat'] },
  { kind: 'split',  num: '09', label: '子功能拆分',    sub: '从设计 → 可执行任务',     section: '四、开始设计',   chip: '拆任务 · 预计 20 分钟',       deps: ['final'] },
];

/** 给定已完成节点集合，返回 kind 节点缺失的上游 deps（按 NODES 顺序） */
export function missingDeps(kind: NodeKind, completed: ReadonlySet<NodeKind>): NodeKind[] {
  const node = getNode(kind);
  if (!node) return [];
  return node.deps.filter((d) => !completed.has(d));
}

/** 节点是否锁定（上游有未完成） */
export function isNodeLocked(kind: NodeKind, completed: ReadonlySet<NodeKind>): boolean {
  return missingDeps(kind, completed).length > 0;
}

export function getNode(kind: string): NodeDef | undefined {
  return NODES.find((n) => n.kind === kind);
}

export function nextNodeKind(current: NodeKind): NodeKind | null {
  const idx = NODES.findIndex((n) => n.kind === current);
  if (idx < 0 || idx >= NODES.length - 1) return null;
  return NODES[idx + 1].kind;
}

export function prevNodeKind(current: NodeKind): NodeKind | null {
  const idx = NODES.findIndex((n) => n.kind === current);
  if (idx <= 0) return null;
  return NODES[idx - 1].kind;
}

/** "NODE · 08 / 09" · 总数从 NODES 自动算 · 再也不用手改硬编码 */
export function formatNodeNum(kind: NodeKind): string {
  const node = getNode(kind);
  const total = String(NODES.length).padStart(2, '0');
  return `NODE · ${node?.num ?? '??'} / ${total}`;
}
