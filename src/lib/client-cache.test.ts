import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKey, cookieNameCandidates, forkCache, readCache, writeCache } from './client-cache';

// Hand-rolled browser stand-ins (node environment; no jsdom dependency).
function installBrowser(protocol = 'http:') {
  const store = new Map<string, string>();
  const sessionStorage = {
    get length() { return store.size; },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
  };
  const cookies = new Map<string, string>();
  const document = {
    get cookie() {
      return Array.from(cookies, ([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(raw: string) {
      const [pair] = raw.split(';');
      const eq = pair.indexOf('=');
      cookies.set(pair.slice(0, eq), pair.slice(eq + 1));
    },
  };
  vi.stubGlobal('window', { location: { protocol } });
  vi.stubGlobal('sessionStorage', sessionStorage);
  vi.stubGlobal('document', document);
  return { store, cookies };
}

/** The done-cookie for a slug, read back via the same candidates the SSR page uses. */
function doneKinds(cookies: Map<string, string>, slug: string): string[] {
  for (const name of cookieNameCandidates(slug)) {
    const v = cookies.get(name);
    if (v !== undefined) return decodeURIComponent(v).split(',').filter(Boolean);
  }
  return [];
}

let env: ReturnType<typeof installBrowser>;

beforeEach(() => {
  env = installBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('cacheKey', () => {
  it('normalizes encoded and decoded slugs to the same key', () => {
    expect(cacheKey('my-proj', 'brief')).toBe('td:my-proj:brief');
    expect(cacheKey(encodeURIComponent('我的项目-ab12'), 'brief')).toBe(cacheKey('我的项目-ab12', 'brief'));
  });

  it('survives a malformed percent sequence', () => {
    expect(cacheKey('100%', 'brief')).toBe('td:100%:brief');
  });
});

describe('readCache / writeCache', () => {
  it('round-trips JSON values per slug and node kind', () => {
    writeCache('p1', 'brief', { a: 1 });
    expect(readCache<{ a: number }>('p1', 'brief')).toEqual({ a: 1 });
    expect(readCache('p1', 'users')).toBeNull();
    expect(readCache('p2', 'brief')).toBeNull();
    expect(env.store.has('td:p1:brief')).toBe(true);
  });

  it('returns null for corrupt JSON instead of throwing', () => {
    env.store.set('td:p1:brief', '{not json');
    expect(readCache('p1', 'brief')).toBeNull();
  });

  it('does not throw when sessionStorage.setItem fails (quota)', () => {
    vi.stubGlobal('sessionStorage', {
      ...sessionStorage,
      setItem: () => { throw new Error('QuotaExceededError'); },
    });
    expect(() => writeCache('p1', 'brief', { a: 1 })).not.toThrow();
  });
});

describe('completion cookie', () => {
  it('records completed node kinds as a comma list', () => {
    writeCache('p1', 'brief', {});
    writeCache('p1', 'users', {});
    expect(doneKinds(env.cookies, 'p1')).toEqual(['brief', 'users']);
  });

  it('does not duplicate a kind written twice', () => {
    writeCache('p1', 'brief', {});
    writeCache('p1', 'brief', { v: 2 });
    expect(doneKinds(env.cookies, 'p1')).toEqual(['brief']);
  });

  it('ignores UI-only suffixes that are not real node kinds', () => {
    writeCache('p1', 'users-ui', { open: true });
    writeCache('p1', 'brief-followups', []);
    expect(env.cookies.size).toBe(0);
    expect(readCache('p1', 'users-ui')).toEqual({ open: true });
  });

  it('keeps projects separate', () => {
    writeCache('p1', 'brief', {});
    writeCache('p2', 'feat', {});
    expect(doneKinds(env.cookies, 'p1')).toEqual(['brief']);
    expect(doneKinds(env.cookies, 'p2')).toEqual(['feat']);
  });

  it('uses a short hashed cookie name for very long slugs, found via cookieNameCandidates', () => {
    const slug = '很长的中文项目名称'.repeat(8) + '-ab12';
    writeCache(slug, 'brief', {});
    const names = Array.from(env.cookies.keys());
    expect(names).toHaveLength(1);
    expect(names[0].startsWith('td-done-h:')).toBe(true);
    expect(names[0].length).toBeLessThan(40);
    expect(doneKinds(env.cookies, slug)).toEqual(['brief']);
  });
});

describe('forkCache', () => {
  it('copies only entries of the source slug to the target slug', () => {
    writeCache('src', 'brief', { n: 1 });
    writeCache('src', 'users-ui', { open: true });
    writeCache('other', 'brief', { n: 9 });
    forkCache('src', 'dst');
    expect(readCache('dst', 'brief')).toEqual({ n: 1 });
    expect(readCache('dst', 'users-ui')).toEqual({ open: true });
    expect(readCache('src', 'brief')).toEqual({ n: 1 });
    expect(env.store.has('td:other:brief')).toBe(true);
    expect(Array.from(env.store.keys()).filter((k) => k.startsWith('td:dst:'))).toHaveLength(2);
  });
});

describe('server-side (no window)', () => {
  it('readCache returns null and writeCache is a no-op', () => {
    vi.unstubAllGlobals();
    expect(readCache('p1', 'brief')).toBeNull();
    expect(() => writeCache('p1', 'brief', {})).not.toThrow();
  });
});
