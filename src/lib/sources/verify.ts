import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { SourceStatus } from '../model/types';
import { isBlockedAddress } from './ip-guard';
import { extractTitle, titlesMatch } from './title';

// Server-side check of one cited URL (SSRF-guarded): http(s) on default ports only, every hop of
// up to 3 redirects re-checked, private / loopback / link-local addresses refused after DNS
// resolution, one time budget for DNS + request + body, a byte cap on the body, then the page
// title loosely compared with the cited title (or, without one, the subject the source is cited
// for). Uses the global fetch, so NODE_USE_ENV_PROXY / a global proxy dispatcher apply as for AI calls.

export type { SourceStatus };

export interface SourceCheck {
  url: string;
  status: SourceStatus;
  verified: boolean;
  pageTitle?: string;
  httpStatus?: number;
  finalUrl?: string;
  detail?: string;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;
export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface VerifyDeps {
  fetch?: FetchLike;
  resolve?: Resolver;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SourceInput {
  url: string;
  title?: string;
  subject?: string;
}

export const SOURCE_CHECK_DEFAULTS = { timeoutMs: 8000, maxBytes: 262144, maxRedirects: 3 };

interface Ctx {
  fetch: FetchLike;
  resolve: Resolver;
  signal: AbortSignal;
  maxBytes: number;
  maxRedirects: number;
}

interface Rejection {
  status: 'blocked' | 'unreachable';
  detail: string;
}

interface Fetched {
  res: Response;
  url: string;
  redirected: boolean;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_TYPE = /text\/html|application\/xhtml\+xml/i;

const defaultResolve: Resolver = async (hostname) => {
  const rows = await lookup(hostname, { all: true, verbatim: true });
  return rows.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

const defaultFetch: FetchLike = (url, init) => globalThis.fetch(url, init);

function withAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => reject(new Error('aborted'));
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function errorDetail(err: unknown): string {
  let detail = String(err);
  if (isRecord(err)) {
    const cause = isRecord(err.cause) ? err.cause : undefined;
    const code = cause?.code ?? err.code;
    if (typeof code === 'string') detail = code;
    else if (typeof err.message === 'string') detail = err.message;
  }
  return detail.slice(0, 120);
}

function isLocalHostname(host: string): boolean {
  return (
    !host.includes('.') || host === 'localhost' || /\.(localhost|local|internal)$/.test(host)
  );
}

async function checkHost(hostname: string, ctx: Ctx): Promise<Rejection | null> {
  const literal = hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
  if (isIP(literal) !== 0) {
    return isBlockedAddress(literal) ? { status: 'blocked', detail: `private address ${literal}` } : null;
  }
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (isLocalHostname(host)) return { status: 'blocked', detail: `local hostname ${host}` };
  let addrs: ResolvedAddress[];
  try {
    addrs = await withAbort(ctx.resolve(host), ctx.signal);
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    return { status: 'unreachable', detail: 'dns failure' };
  }
  if (addrs.length === 0) return { status: 'unreachable', detail: 'dns failure' };
  // A DNS-rebinding window remains between this lookup and fetch's own lookup; accepted so the global fetch
  // (and thus the env proxy) is used.
  const bad = addrs.find((a) => isBlockedAddress(a.address));
  return bad ? { status: 'blocked', detail: `private address ${bad.address}` } : null;
}

async function checkUrl(raw: string, ctx: Ctx): Promise<{ url: URL } | Rejection> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return { status: 'blocked', detail: 'invalid url' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { status: 'blocked', detail: 'non-http(s) scheme' };
  if (u.username || u.password) return { status: 'blocked', detail: 'credentials not allowed' };
  // WHATWG URL drops default ports, so any remaining port is non-default.
  if (u.port !== '') return { status: 'blocked', detail: 'port not allowed' };
  const rejection = await checkHost(u.hostname, ctx);
  return rejection ?? { url: u };
}

function redirectTarget(res: Response, current: string): string | null {
  const location = res.headers.get('location');
  if (!REDIRECT_STATUSES.has(res.status) || !location) return null;
  try {
    return new URL(location, current).href;
  } catch {
    return location;
  }
}

async function cancelBody(res: Response): Promise<void> {
  try {
    await res.body?.cancel();
  } catch {
    // ignore: the body is being discarded anyway
  }
}

async function fetchFollowing(raw: string, ctx: Ctx): Promise<Fetched | Rejection> {
  const init: RequestInit = {
    method: 'GET',
    redirect: 'manual',
    signal: ctx.signal,
    headers: {
      accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
      'user-agent': 'ThinkingDesk-SourceCheck/0.1 (+self-hosted)',
    },
  };
  let current = raw;
  for (let hop = 0; hop <= ctx.maxRedirects; hop++) {
    const checked = await checkUrl(current, ctx);
    if (!('url' in checked)) return checked;
    const res = await withAbort(ctx.fetch(checked.url.href, init), ctx.signal);
    const next = redirectTarget(res, checked.url.href);
    if (next === null) return { res, url: checked.url.href, redirected: hop > 0 };
    await cancelBody(res);
    current = next;
  }
  return { status: 'unreachable', detail: 'too many redirects' };
}

async function readCapped(res: Response, maxBytes: number, signal: AbortSignal): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let finished = false;
  try {
    while (total < maxBytes) {
      const { done, value } = await withAbort(reader.read(), signal);
      if (done) {
        finished = true;
        break;
      }
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    if (!finished) reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out.subarray(0, maxBytes);
}

function decodeHtml(bytes: Uint8Array, contentType: string): string {
  const fromHeader = /charset\s*=\s*["']?([^\s;"']+)/i.exec(contentType)?.[1];
  // latin1 maps every byte to a char, so ASCII markup is searchable before the real charset is known.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 4096));
  const fromMeta = /<meta\b[^>]*?\bcharset\s*=\s*["']?\s*([\w.:-]+)/i.exec(head)?.[1];
  try {
    return new TextDecoder(fromHeader ?? fromMeta ?? 'utf-8').decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

async function describeFinal(source: SourceInput, got: Fetched, ctx: Ctx): Promise<SourceCheck> {
  const { res } = got;
  const base: SourceCheck = { url: source.url, status: 'reachable', verified: false, httpStatus: res.status };
  if (got.redirected && got.url !== source.url) base.finalUrl = got.url;
  if (res.status < 200 || res.status >= 300) {
    await cancelBody(res);
    const why = res.status >= 400 ? `HTTP ${res.status}` : `HTTP ${res.status} without usable redirect`;
    return { ...base, status: 'unreachable', detail: why };
  }
  const contentType = res.headers.get('content-type') ?? '';
  if (!HTML_TYPE.test(contentType)) {
    await cancelBody(res);
    return base;
  }
  const bytes = await readCapped(res, ctx.maxBytes, ctx.signal);
  const pageTitle = extractTitle(decodeHtml(bytes, contentType));
  if (pageTitle) base.pageTitle = pageTitle;
  const expected = source.title?.trim() || source.subject?.trim();
  if (pageTitle && expected && titlesMatch(expected, pageTitle)) {
    return { ...base, status: 'title_match', verified: true };
  }
  return base;
}

function failure(url: string, status: 'blocked' | 'unreachable', detail: string): SourceCheck {
  return { url, status, verified: false, detail };
}

export async function verifySource(source: SourceInput, deps: VerifyDeps = {}): Promise<SourceCheck> {
  const controller = new AbortController();
  const timeoutMs = deps.timeoutMs ?? SOURCE_CHECK_DEFAULTS.timeoutMs;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const ctx: Ctx = {
    fetch: deps.fetch ?? defaultFetch,
    resolve: deps.resolve ?? defaultResolve,
    signal: controller.signal,
    maxBytes: deps.maxBytes ?? SOURCE_CHECK_DEFAULTS.maxBytes,
    maxRedirects: deps.maxRedirects ?? SOURCE_CHECK_DEFAULTS.maxRedirects,
  };
  try {
    const got = await fetchFollowing(source.url, ctx);
    if ('res' in got) return await describeFinal(source, got, ctx);
    return failure(source.url, got.status, got.detail);
  } catch (err) {
    return failure(source.url, 'unreachable', controller.signal.aborted ? 'timeout' : errorDetail(err));
  } finally {
    clearTimeout(timer);
  }
}

export async function verifySources(
  sources: ReadonlyArray<SourceInput>,
  deps: VerifyDeps = {},
  concurrency = 4,
): Promise<SourceCheck[]> {
  const results = new Array<SourceCheck>(sources.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < sources.length) {
      const i = next++;
      results[i] = await verifySource(sources[i], deps);
    }
  };
  const workers = Math.min(Math.max(1, Math.floor(concurrency)), sources.length);
  await Promise.all(Array.from({ length: workers }, worker));
  return results;
}
