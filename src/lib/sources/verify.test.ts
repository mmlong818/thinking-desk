import { describe, expect, it, vi } from 'vitest';
import { SOURCE_CHECK_DEFAULTS, verifySource, verifySources } from './verify';
import type { FetchLike, ResolvedAddress, Resolver } from './verify';

type Route = () => Response | Promise<Response>;

const HTML = { 'content-type': 'text/html; charset=utf-8' };

function html(title: string, headers: Record<string, string> = HTML): Response {
  return new Response(`<html><head><title>${title}</title></head><body>hi</body></html>`, { status: 200, headers });
}

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

function fakeFetch(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fn: FetchLike = async (url) => {
    calls.push(url);
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return route();
  };
  return { fn, calls };
}

function fakeResolver(map: Record<string, string[]>) {
  const calls: string[] = [];
  const fn: Resolver = async (hostname) => {
    calls.push(hostname);
    const addrs = map[hostname];
    if (!addrs) throw new Error('ENOTFOUND');
    return addrs.map((address): ResolvedAddress => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
  return { fn, calls };
}

const PUBLIC = { 'example.com': ['93.184.216.34'], 'a.example.com': ['93.184.216.34'], 'b.example.com': ['1.1.1.1'] };

describe('verifySource: URL and host rejection', () => {
  it.each([
    ['not a url', 'invalid url'],
    ['ftp://example.com/file', 'non-http(s) scheme'],
    ['javascript:alert(1)', 'non-http(s) scheme'],
    ['https://user:pw@example.com/', 'credentials not allowed'],
    ['https://user@example.com/', 'credentials not allowed'],
    ['https://example.com:8443/', 'port not allowed'],
    ['http://example.com:8080/', 'port not allowed'],
    ['http://example.com:443/', 'port not allowed'],
  ])('blocks %s', async (url, detail) => {
    const f = fakeFetch({});
    const r = fakeResolver(PUBLIC);
    const out = await verifySource({ url }, { fetch: f.fn, resolve: r.fn });
    expect(out).toMatchObject({ url, status: 'blocked', verified: false, detail });
    expect(f.calls).toEqual([]);
    expect(r.calls).toEqual([]);
  });

  it('allows explicit default ports', async () => {
    const f = fakeFetch({ 'https://example.com/': () => html('Example'), 'http://example.com/': () => html('Example') });
    const deps = { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn };
    expect((await verifySource({ url: 'https://example.com:443/' }, deps)).status).toBe('reachable');
    expect((await verifySource({ url: 'http://example.com:80/' }, deps)).status).toBe('reachable');
  });

  it.each(['http://127.0.0.1/', 'http://[::1]/', 'http://2130706433/', 'http://[::ffff:10.0.0.1]/'])(
    'blocks IP literal %s without resolving or fetching',
    async (url) => {
      const f = fakeFetch({});
      const r = fakeResolver({});
      const out = await verifySource({ url }, { fetch: f.fn, resolve: r.fn });
      expect(out.status).toBe('blocked');
      expect(out.detail).toMatch(/^private address /);
      expect(f.calls).toEqual([]);
      expect(r.calls).toEqual([]);
    },
  );

  it.each(['http://localhost/', 'http://foo.localhost/', 'http://printer.local/', 'http://db.internal/', 'http://intranet/'])(
    'blocks local hostname %s without resolving or fetching',
    async (url) => {
      const f = fakeFetch({});
      const r = fakeResolver({});
      const out = await verifySource({ url }, { fetch: f.fn, resolve: r.fn });
      expect(out.status).toBe('blocked');
      expect(f.calls).toEqual([]);
      expect(r.calls).toEqual([]);
    },
  );

  it('blocks a hostname that resolves to a private address, without fetching', async () => {
    const f = fakeFetch({});
    const r = fakeResolver({ 'evil.example.com': ['10.0.0.5'] });
    const out = await verifySource({ url: 'https://evil.example.com/' }, { fetch: f.fn, resolve: r.fn });
    expect(out).toMatchObject({ status: 'blocked', detail: 'private address 10.0.0.5' });
    expect(f.calls).toEqual([]);
  });

  it('blocks when any one of several resolved addresses is private', async () => {
    const f = fakeFetch({});
    const r = fakeResolver({ 'mixed.example.com': ['93.184.216.34', '2606:4700:4700::1111', 'fd00::1'] });
    const out = await verifySource({ url: 'https://mixed.example.com/' }, { fetch: f.fn, resolve: r.fn });
    expect(out).toMatchObject({ status: 'blocked', detail: 'private address fd00::1' });
    expect(f.calls).toEqual([]);
  });

  it('reports dns failure as unreachable', async () => {
    const f = fakeFetch({});
    const out = await verifySource({ url: 'https://nope.example.com/' }, { fetch: f.fn, resolve: fakeResolver({}).fn });
    expect(out).toMatchObject({ status: 'unreachable', detail: 'dns failure' });
    const empty = await verifySource({ url: 'https://nope.example.com/' }, { fetch: f.fn, resolve: async () => [] });
    expect(empty).toMatchObject({ status: 'unreachable', detail: 'dns failure' });
  });
});

describe('verifySource: redirects', () => {
  it('follows a chain, re-resolving each hop, and reports finalUrl', async () => {
    const f = fakeFetch({
      'https://example.com/start': () => redirect('https://a.example.com/one', 301),
      'https://a.example.com/one': () => redirect('/two', 307),
      'https://a.example.com/two': () => html('Landing'),
    });
    const r = fakeResolver(PUBLIC);
    const out = await verifySource({ url: 'https://example.com/start', title: 'Landing' }, { fetch: f.fn, resolve: r.fn });
    expect(f.calls).toEqual(['https://example.com/start', 'https://a.example.com/one', 'https://a.example.com/two']);
    expect(r.calls).toEqual(['example.com', 'a.example.com', 'a.example.com']);
    expect(out).toMatchObject({
      status: 'title_match',
      verified: true,
      httpStatus: 200,
      finalUrl: 'https://a.example.com/two',
      pageTitle: 'Landing',
    });
  });

  it('cancels the body of redirect responses', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const f = fakeFetch({
      'https://example.com/a': () => new Response(body, { status: 302, headers: { location: 'https://example.com/b' } }),
      'https://example.com/b': () => html('B'),
    });
    await verifySource({ url: 'https://example.com/a' }, { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('blocks a redirect into a private target', async () => {
    const f = fakeFetch({ 'https://example.com/': () => redirect('http://169.254.169.254/latest/meta-data') });
    const out = await verifySource({ url: 'https://example.com/' }, { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn });
    expect(out).toMatchObject({ status: 'blocked', verified: false, detail: 'private address 169.254.169.254' });
    expect(f.calls).toEqual(['https://example.com/']);
  });

  it('blocks a redirect to a hostname that resolves privately and to a non-http scheme', async () => {
    const r = fakeResolver({ ...PUBLIC, 'sneaky.example.com': ['192.168.0.1'] });
    const a = fakeFetch({ 'https://example.com/': () => redirect('https://sneaky.example.com/') });
    expect((await verifySource({ url: 'https://example.com/' }, { fetch: a.fn, resolve: r.fn })).status).toBe('blocked');
    const b = fakeFetch({ 'https://example.com/': () => redirect('file:///etc/passwd') });
    const out = await verifySource({ url: 'https://example.com/' }, { fetch: b.fn, resolve: r.fn });
    expect(out).toMatchObject({ status: 'blocked', detail: 'non-http(s) scheme' });
  });

  it('gives up after maxRedirects', async () => {
    const f = fakeFetch({
      'https://example.com/0': () => redirect('/1'),
      'https://example.com/1': () => redirect('/2'),
      'https://example.com/2': () => redirect('/3'),
      'https://example.com/3': () => redirect('/4'),
      'https://example.com/4': () => html('never'),
    });
    const out = await verifySource(
      { url: 'https://example.com/0' },
      { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn, maxRedirects: 3 },
    );
    expect(out).toMatchObject({ status: 'unreachable', detail: 'too many redirects' });
    expect(f.calls).toHaveLength(4);
  });

  it('allows exactly maxRedirects hops', async () => {
    const f = fakeFetch({
      'https://example.com/0': () => redirect('/1'),
      'https://example.com/1': () => redirect('/2'),
      'https://example.com/2': () => redirect('/3'),
      'https://example.com/3': () => html('Done'),
    });
    const out = await verifySource({ url: 'https://example.com/0' }, { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn });
    expect(out.status).toBe('reachable');
    expect(out.finalUrl).toBe('https://example.com/3');
  });

  it('sends the documented request shape', async () => {
    const seen: RequestInit[] = [];
    const fetchFn: FetchLike = async (_url, init) => {
      seen.push(init);
      return html('x');
    };
    await verifySource({ url: 'https://example.com/' }, { fetch: fetchFn, resolve: fakeResolver(PUBLIC).fn });
    expect(seen[0]).toMatchObject({ method: 'GET', redirect: 'manual' });
    expect(seen[0].signal).toBeInstanceOf(AbortSignal);
    expect(seen[0].headers).toMatchObject({ 'user-agent': 'ThinkingDesk-SourceCheck/0.1 (+self-hosted)' });
  });
});

describe('verifySource: timeout and size cap', () => {
  it('maps a hanging fetch to unreachable/timeout quickly', async () => {
    const hang: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const started = Date.now();
    const out = await verifySource({ url: 'https://example.com/' }, { fetch: hang, resolve: fakeResolver(PUBLIC).fn, timeoutMs: 50 });
    expect(out).toMatchObject({ status: 'unreachable', verified: false, detail: 'timeout' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('times out on a hanging resolver and a stalled body', async () => {
    const never = () => new Promise<never>(() => undefined);
    const a = await verifySource({ url: 'https://example.com/' }, { fetch: fakeFetch({}).fn, resolve: never, timeoutMs: 50 });
    expect(a.detail).toBe('timeout');
    const stalled = new ReadableStream<Uint8Array>({ pull: never });
    const f = fakeFetch({ 'https://example.com/': () => new Response(stalled, { headers: HTML }) });
    const b = await verifySource({ url: 'https://example.com/' }, { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn, timeoutMs: 50 });
    expect(b).toMatchObject({ status: 'unreachable', detail: 'timeout' });
  });

  it('stops reading at maxBytes and still finds a title at the start', async () => {
    const chunkSize = 16384;
    const head = new TextEncoder().encode('<html><head><title>Huge Page</title></head><body>');
    let pulled = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          const chunk = new Uint8Array(chunkSize).fill(97);
          if (pulled === 0) chunk.set(head);
          pulled += chunk.byteLength;
          controller.enqueue(chunk);
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const f = fakeFetch({ 'https://example.com/': () => new Response(body, { headers: HTML }) });
    const out = await verifySource(
      { url: 'https://example.com/', title: 'Huge Page' },
      { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn, maxBytes: 32768 },
    );
    expect(out).toMatchObject({ status: 'title_match', pageTitle: 'Huge Page' });
    expect(pulled).toBeLessThanOrEqual(32768 + chunkSize);
    expect(cancelled).toBe(true);
  });

  it('exposes the defaults', () => {
    expect(SOURCE_CHECK_DEFAULTS).toEqual({ timeoutMs: 8000, maxBytes: 262144, maxRedirects: 3 });
  });
});

describe('verifySource: charset', () => {
  const gbkBytes = (): Uint8Array =>
    new Uint8Array([
      ...new TextEncoder().encode('<html><head>'),
      ...new TextEncoder().encode('@META@<title>'),
      0xd6,
      0xd0,
      0xce,
      0xc4,
      ...new TextEncoder().encode('</title></head></html>'),
    ]);

  function withMeta(meta: string): Uint8Array<ArrayBuffer> {
    const raw = gbkBytes();
    const marker = new TextEncoder().encode('@META@');
    const at = raw.findIndex((_, i) => marker.every((b, j) => raw[i + j] === b));
    return new Uint8Array([...raw.subarray(0, at), ...new TextEncoder().encode(meta), ...raw.subarray(at + marker.length)]);
  }

  it('decodes using the charset from the Content-Type header', async () => {
    const f = fakeFetch({
      'https://example.com/': () => new Response(withMeta(''), { headers: { 'content-type': 'text/html; charset=gbk' } }),
    });
    const out = await verifySource({ url: 'https://example.com/', title: '中文' }, { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn });
    expect(out).toMatchObject({ status: 'title_match', pageTitle: '中文' });
  });

  it.each(['<meta charset="gbk">', '<meta http-equiv="Content-Type" content="text/html; charset=GBK">'])(
    'sniffs the charset from %s when the header has none',
    async (meta) => {
      const f = fakeFetch({ 'https://example.com/': () => new Response(withMeta(meta), { headers: { 'content-type': 'text/html' } }) });
      const out = await verifySource({ url: 'https://example.com/' }, { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn });
      expect(out.pageTitle).toBe('中文');
    },
  );

  it('falls back to utf-8 for an unsupported label', async () => {
    const f = fakeFetch({ 'https://example.com/': () => html('Fine', { 'content-type': 'text/html; charset=x-bogus-123' }) });
    const out = await verifySource({ url: 'https://example.com/' }, { fetch: f.fn, resolve: fakeResolver(PUBLIC).fn });
    expect(out.pageTitle).toBe('Fine');
  });
});

describe('verifySource: status mapping', () => {
  const deps = (routes: Record<string, Route>) => ({ fetch: fakeFetch(routes).fn, resolve: fakeResolver(PUBLIC).fn });

  it('maps HTTP errors to unreachable with httpStatus', async () => {
    const out = await verifySource(
      { url: 'https://example.com/gone' },
      deps({ 'https://example.com/gone': () => new Response('nope', { status: 404, headers: HTML }) }),
    );
    expect(out).toMatchObject({ status: 'unreachable', verified: false, httpStatus: 404, detail: 'HTTP 404' });
    expect(out.pageTitle).toBeUndefined();
  });

  it('treats a non-HTML 200 as reachable without a title', async () => {
    const out = await verifySource(
      { url: 'https://example.com/a.pdf', title: 'A paper' },
      deps({ 'https://example.com/a.pdf': () => new Response('%PDF-1.7', { headers: { 'content-type': 'application/pdf' } }) }),
    );
    expect(out).toMatchObject({ status: 'reachable', verified: false, httpStatus: 200 });
    expect(out.pageTitle).toBeUndefined();
    expect(out.finalUrl).toBeUndefined();
  });

  it('distinguishes title match, mismatch and subject fallback', async () => {
    const d = deps({ 'https://example.com/': () => html('Notion – The all-in-one workspace') });
    expect(await verifySource({ url: 'https://example.com/', title: 'Notion' }, d)).toMatchObject({
      status: 'title_match',
      verified: true,
    });
    expect(await verifySource({ url: 'https://example.com/', title: 'OpenAI pricing' }, d)).toMatchObject({
      status: 'reachable',
      verified: false,
      pageTitle: 'Notion – The all-in-one workspace',
    });
    expect(await verifySource({ url: 'https://example.com/', title: '  ', subject: 'Notion' }, d)).toMatchObject({
      status: 'title_match',
    });
    expect(await verifySource({ url: 'https://example.com/', title: 'OpenAI pricing', subject: 'Notion' }, d)).toMatchObject({
      status: 'reachable',
    });
    expect(await verifySource({ url: 'https://example.com/' }, d)).toMatchObject({ status: 'reachable', verified: false });
  });

  it('maps network errors to unreachable using cause.code', async () => {
    const boom: FetchLike = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    };
    const out = await verifySource({ url: 'https://example.com/' }, { fetch: boom, resolve: fakeResolver(PUBLIC).fn });
    expect(out).toMatchObject({ status: 'unreachable', verified: false, detail: 'ECONNREFUSED' });
    const plain: FetchLike = async () => {
      throw new Error('x'.repeat(300));
    };
    const out2 = await verifySource({ url: 'https://example.com/' }, { fetch: plain, resolve: fakeResolver(PUBLIC).fn });
    expect(out2.detail).toHaveLength(120);
  });
});

describe('verifySources', () => {
  it('preserves input order with bounded concurrency', async () => {
    let active = 0;
    let peak = 0;
    const delays = [40, 5, 25, 1, 15];
    const fetchFn: FetchLike = async (url) => {
      active++;
      peak = Math.max(peak, active);
      const i = Number(new URL(url).pathname.slice(1));
      await new Promise((r) => setTimeout(r, delays[i]));
      active--;
      return html(`Page ${i}`);
    };
    const sources = delays.map((_, i) => ({ url: `https://example.com/${i}`, title: `Page ${i}` }));
    const out = await verifySources(sources, { fetch: fetchFn, resolve: fakeResolver(PUBLIC).fn }, 2);
    expect(out.map((o) => o.url)).toEqual(sources.map((s) => s.url));
    expect(out.map((o) => o.pageTitle)).toEqual(['Page 0', 'Page 1', 'Page 2', 'Page 3', 'Page 4']);
    expect(out.every((o) => o.status === 'title_match')).toBe(true);
    expect(peak).toBe(2);
  });

  it('handles an empty list', async () => {
    expect(await verifySources([])).toEqual([]);
  });
});
