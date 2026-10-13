// localStorage fallback for the projects list — keeps the home page useful
// when Postgres isn't available (dev without Docker).
// Server-persisted projects always win; local entries are merged in when
// their slug isn't already in the server response.

import { localProjectId } from './model/local-repository';
import { removeLocalProjectData } from './model/local-transfer';
import { clearCompletionCookies } from './store/completion-cookie';
import { purgeUi } from './store/ui-cache';

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

/** 删除一个本地项目条目（仅项目列表，不动项目数据）。 */
export function removeLocalProject(slug: string): void {
  const list = read();
  const next = list.filter((p) => p.slug !== slug);
  if (next.length !== list.length) write(next);
}

/**
 * 删除项目时清掉它在本浏览器里的一切：本地项目文档（td:v2:<id> 及其损坏备份）、UI 缓存、完成状态 cookie、项目列表条目。
 */
export function purgeProjectClientData(slug: string): void {
  if (typeof window === 'undefined') return;
  const projectId = localProjectId(slug);
  try {
    removeLocalProjectData(window.localStorage, projectId);
  } catch {
    // storage unavailable — nothing stored either
  }
  purgeUi(projectId);
  clearCompletionCookies(slug);
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
