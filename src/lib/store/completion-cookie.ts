import { NODES, type NodeKind } from '../../data/nodes';
import { completionCookieValue } from '../model/completion';

// The `td-done:<slug>` cookie: a cache of the node completion derived from items
// (completedNodes), so the SSR lock screen works in pure-local mode where the server cannot
// read localStorage. It carries kind names only and is overwritten after every write — a node
// whose last accepted item was un-accepted drops out again.
// Long slugs use a short hashed name (`td-done-h:<hash>`) to stay under the cookie size limit.

const SLUG_HASH_LEN = 12;
const MAX_AGE_S = 30 * 24 * 3600;

function decodeSlug(slug: string): string {
  try {
    return decodeURIComponent(slug);
  } catch {
    return slug;
  }
}

function slugHash(slug: string): string {
  // Non-cryptographic: only needs to be short and stable.
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = ((h << 5) - h + slug.charCodeAt(i)) | 0;
  return ((h >>> 0).toString(36) + slug.length.toString(36)).slice(0, SLUG_HASH_LEN);
}

function cookieNameFor(slug: string): string {
  const enc = encodeURIComponent(slug);
  return enc.length <= 40 ? `td-done:${enc}` : `td-done-h:${slugHash(slug)}`;
}

/** Every cookie name that may hold a slug's completion (SSR reads the first one present). */
export function cookieNameCandidates(slug: string): string[] {
  const decoded = decodeSlug(slug);
  return Array.from(new Set([
    `td-done:${encodeURIComponent(decoded)}`,
    `td-done:${slug}`,
    `td-done-h:${slugHash(decoded)}`,
  ]));
}

/** Completed kinds from a cookie value; unknown names are ignored. */
export function parseCompletionCookie(value: string | undefined): NodeKind[] {
  if (!value) return [];
  const known = new Set<string>(NODES.map((n) => n.kind));
  return value.split(',').filter((k): k is NodeKind => known.has(k));
}

function secureFlag(): string {
  return typeof window !== 'undefined' && window.location?.protocol === 'https:' ? '; secure' : '';
}

/** Overwrites the slug's completion cookie with the derived value (deletes it when empty). */
export function writeCompletionCookie(slug: string, completed: ReadonlySet<NodeKind>): void {
  if (typeof document === 'undefined') return;
  const name = cookieNameFor(decodeSlug(slug));
  const value = completionCookieValue(completed);
  const maxAge = value ? MAX_AGE_S : 0;
  document.cookie = `${name}=${value}; path=/; max-age=${maxAge}; samesite=lax${secureFlag()}`;
}

/** Removes every completion cookie a slug may have (project deletion). */
export function clearCompletionCookies(slug: string): void {
  if (typeof document === 'undefined') return;
  for (const name of cookieNameCandidates(slug)) {
    document.cookie = `${name}=; path=/; max-age=0; samesite=lax`;
  }
}
