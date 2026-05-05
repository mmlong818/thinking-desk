// sessionStorage-backed cache so nodes can read prior nodes' output when the
// Postgres layer isn't available (dev without Docker).
// Key format: `td:<projectSlug>:<nodeKind>` · value is JSON string.

/** Normalize so encoded / decoded forms of the same slug share one cache entry. */
function normSlug(slug: string): string {
  try { return decodeURIComponent(slug); } catch { return slug; }
}

export function cacheKey(projectSlug: string, nodeKind: string): string {
  return `td:${normSlug(projectSlug)}:${nodeKind}`;
}

export function readCache<T>(projectSlug: string, nodeKind: string): T | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(cacheKey(projectSlug, nodeKind));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function writeCache(projectSlug: string, nodeKind: string, value: unknown): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(cacheKey(projectSlug, nodeKind), JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
  markDone(projectSlug, nodeKind);
}

/**
 * Pure-local mode: when Postgres is unavailable the server can't see
 * sessionStorage. Mirror node completion in a cookie so the SSR pass in
 * `app/project/[id]/[node]/page.tsx` can mark upstream nodes complete and
 * skip the lock screen. The cookie carries only kind names (no content),
 * which keeps it under 4KB even for 9 nodes × many slugs.
 *
 * UI-only suffixes like 'users-ui' are filtered to avoid polluting the
 * dependency graph; node kinds are validated to a small allowlist.
 *
 * Slug 取 hash 防超长（H9）：长中文 slug × 多项目会撞 cookie 4KB 上限并静默丢失。
 */
const NODE_KINDS = new Set([
  'brief', 'users', 'stake', 'alt', 'scen', 'feat', 'leap', 'final', 'split',
]);

const SLUG_HASH_LEN = 12;

function slugHash(slug: string): string {
  // 简单非加密 hash，目标只是 cookie name 短而稳定
  let h = 0;
  for (let i = 0; i < slug.length; i++) {
    h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  }
  // 32 bit unsigned + base36
  return ((h >>> 0).toString(36) + slug.length.toString(36)).slice(0, SLUG_HASH_LEN);
}

function cookieNameFor(slug: string): string {
  // 短 slug 直接用，长 slug 取 hash 防止 cookie 超 4KB
  const enc = encodeURIComponent(slug);
  if (enc.length <= 40) return `td-done:${enc}`;
  return `td-done-h:${slugHash(slug)}`;
}

/** SSR / 测试用：列出可能匹配 slug 的所有 cookie name 候选，按精度排序。 */
export function cookieNameCandidates(slug: string): string[] {
  const candidates: string[] = [];
  let decoded = slug;
  try { decoded = decodeURIComponent(slug); } catch { /* noop */ }
  const enc = encodeURIComponent(decoded);
  candidates.push(`td-done:${enc}`);
  candidates.push(`td-done:${slug}`);
  candidates.push(`td-done-h:${slugHash(decoded)}`);
  return Array.from(new Set(candidates));
}

function markDone(projectSlug: string, nodeKind: string): void {
  if (typeof document === 'undefined') return;
  if (!NODE_KINDS.has(nodeKind)) return;
  const slug = normSlug(projectSlug);
  const name = cookieNameFor(slug);
  const current = readCookie(name);
  const set = new Set(current ? current.split(',').filter(Boolean) : []);
  if (set.has(nodeKind)) return;
  set.add(nodeKind);
  const value = Array.from(set).join(',');
  // 容量保护：name + value + 元数据共 ≤ 3.5KB，留余量
  const meta = '; path=/; max-age=2592000; samesite=lax';
  const isHttps =
    typeof window !== 'undefined' && window.location && window.location.protocol === 'https:';
  const secure = isHttps ? '; secure' : '';
  const full = `${name}=${value}${meta}${secure}`;
  if (full.length > 3500) return;
  document.cookie = full;
}

function readCookie(name: string): string | null {
  // 转义所有 RegExp 元字符（含 `-`，避免位于字符类时被解析为范围）
  const escaped = name.replace(/[-.$?*|{}()[\]\\/+^]/g, '\\$&');
  const m = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

/**
 * 把一个项目的所有节点 cache 复制到新 slug。
 * 用于"分支当前项目"——并行探索另一条方向。
 *
 * 派生 follow-ups（`<kind>-followups`）和 UI 状态（`*-ui`）刻意一并复制：
 * fork 后用户通常希望立刻看到上一份的所有内容；如果想强制重派生，删 `td:<slug>:*-followups` 即可。
 */
export function forkCache(fromSlug: string, toSlug: string): void {
  if (typeof window === 'undefined') return;
  const fromPrefix = `td:${normSlug(fromSlug)}:`;
  const toPrefix = `td:${normSlug(toSlug)}:`;
  // Snapshot first — mutating sessionStorage while iterating is fragile.
  const entries: [string, string][] = [];
  for (let i = 0; i < sessionStorage.length; i++) {
    const k = sessionStorage.key(i);
    if (!k || !k.startsWith(fromPrefix)) continue;
    const v = sessionStorage.getItem(k);
    if (v !== null) entries.push([k.slice(fromPrefix.length), v]);
  }
  for (const [tail, value] of entries) {
    sessionStorage.setItem(`${toPrefix}${tail}`, value);
  }
}
