// localStorage fallback for the projects list — keeps the home page useful
// when Postgres isn't available (dev without Docker).
// Server-persisted projects always win; local entries are merged in when
// their slug isn't already in the server response.

export interface LocalProject {
  id: string;
  slug: string;
  name: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

const KEY = 'td:local-projects';

function read(): LocalProject[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LocalProject[]) : [];
  } catch {
    return [];
  }
}

function write(list: LocalProject[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // ignore quota
  }
}

export function listLocalProjects(): LocalProject[] {
  return read().sort((a, b) => (b.updated_at > a.updated_at ? 1 : -1));
}

export function addLocalProject(project: Omit<LocalProject, 'id' | 'created_at' | 'updated_at'> & { id?: string }): LocalProject {
  const now = new Date().toISOString();
  const entry: LocalProject = {
    id: project.id ?? `local-${Math.random().toString(36).slice(2, 10)}`,
    slug: project.slug,
    name: project.name,
    summary: project.summary,
    created_at: now,
    updated_at: now,
  };
  const next = [entry, ...read().filter((p) => p.slug !== entry.slug)];
  write(next);
  return entry;
}

export function touchLocalProject(slug: string): void {
  const list = read();
  const idx = list.findIndex((p) => p.slug === slug);
  if (idx < 0) return;
  list[idx] = { ...list[idx], updated_at: new Date().toISOString() };
  write(list);
}

/** 删除一个本地项目条目（仅 localStorage 列表，不动 sessionStorage 节点缓存）。 */
export function removeLocalProject(slug: string): void {
  const list = read();
  const next = list.filter((p) => p.slug !== slug);
  if (next.length !== list.length) write(next);
}

/**
 * 把项目相关的所有客户端缓存（sessionStorage 节点 + 派生 follow-ups + cookie 标记 + localStorage 项目条目）一次清掉。
 */
export function purgeProjectClientData(slug: string): void {
  if (typeof window === 'undefined') return;
  let decoded = slug;
  try { decoded = decodeURIComponent(slug); } catch { /* noop */ }
  // sessionStorage：所有 td:<slug>:* 形态的 entry
  try {
    const targets: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (!k) continue;
      if (k.startsWith(`td:${slug}:`) || k.startsWith(`td:${decoded}:`)) targets.push(k);
      if (k === `td:import-warn:${slug}` || k === `td:import-warn:${decoded}`) targets.push(k);
    }
    for (const k of targets) sessionStorage.removeItem(k);
  } catch { /* ignore */ }
  // cookie：td-done:<encoded slug> 失效
  try {
    const enc = encodeURIComponent(decoded);
    document.cookie = `td-done:${enc}=; path=/; max-age=0; samesite=lax`;
    document.cookie = `td-done:${slug}=; path=/; max-age=0; samesite=lax`;
  } catch { /* ignore */ }
  // localStorage 项目条目
  removeLocalProject(slug);
}

export function generateLocalSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  const suffix = Math.random().toString(36).slice(2, 6);
  return `${base || 'proj'}-${suffix}`;
}
