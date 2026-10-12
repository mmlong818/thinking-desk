import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCompletionCookies,
  cookieNameCandidates,
  parseCompletionCookie,
  writeCompletionCookie,
} from './completion-cookie';

// A minimal cookie jar standing in for document.cookie (set = one assignment, get = all pairs).
function cookieJar() {
  const jar = new Map<string, string>();
  return {
    jar,
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
    },
    set cookie(line: string) {
      const [pair, ...attrs] = line.split('; ');
      const i = pair.indexOf('=');
      const name = pair.slice(0, i);
      if (attrs.includes('max-age=0')) jar.delete(name);
      else jar.set(name, pair.slice(i + 1));
    },
  };
}

let doc: ReturnType<typeof cookieJar>;
beforeEach(() => {
  doc = cookieJar();
  vi.stubGlobal('document', doc);
});
afterEach(() => vi.unstubAllGlobals());

const valueFor = (slug: string) => {
  for (const name of cookieNameCandidates(slug)) {
    const v = doc.jar.get(name);
    if (v !== undefined) return v;
  }
  return undefined;
};

describe('writeCompletionCookie', () => {
  it('overwrites with the derived set (in node order), so an un-completed node drops out', () => {
    writeCompletionCookie('p1', new Set(['users', 'brief']));
    expect(valueFor('p1')).toBe('brief,users');
    writeCompletionCookie('p1', new Set(['brief']));
    expect(valueFor('p1')).toBe('brief');
  });

  it('deletes the cookie when nothing is complete', () => {
    writeCompletionCookie('p1', new Set(['brief']));
    writeCompletionCookie('p1', new Set());
    expect(valueFor('p1')).toBeUndefined();
  });

  it('encoded and decoded slugs share one cookie; long slugs use the hashed name', () => {
    writeCompletionCookie('%E9%A1%B9%E7%9B%AE', new Set(['brief']));
    expect(valueFor('项目')).toBe('brief');
    const long = '很长的项目名'.repeat(10);
    writeCompletionCookie(long, new Set(['feat']));
    expect([...doc.jar.keys()].some((k) => k.startsWith('td-done-h:'))).toBe(true);
    expect(valueFor(long)).toBe('feat');
  });

  it('clearCompletionCookies removes every candidate', () => {
    writeCompletionCookie('p1', new Set(['brief']));
    clearCompletionCookies('p1');
    expect(doc.jar.size).toBe(0);
  });
});

describe('parseCompletionCookie', () => {
  it('keeps known kinds only', () => {
    expect(parseCompletionCookie('brief,users-ui,nope,feat')).toEqual(['brief', 'feat']);
    expect(parseCompletionCookie(undefined)).toEqual([]);
  });
});
