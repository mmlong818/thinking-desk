import { describe, expect, it } from 'vitest';
import { SourceCheckResponseSchema } from './protocol';
import { createSourceCheckRoute } from './route';
import type { FetchLike, Resolver } from './verify';

// The route with DNS and the network injected: nothing here touches the real network.

const resolve: Resolver = async (host) => (host === 'intranet.example.com'
  ? [{ address: '10.0.0.5', family: 4 }]
  : [{ address: '93.184.216.34', family: 4 }]);

const fetch: FetchLike = async (url) => {
  if (url.startsWith('https://www.notion.so')) {
    return new Response('<html><head><title>Notion – The all-in-one workspace</title></head></html>', { headers: { 'content-type': 'text/html' } });
  }
  return new Response('missing', { status: 404 });
};

const call = async (body: unknown) => {
  const POST = createSourceCheckRoute({ fetch, resolve });
  const res = await POST(new Request('http://localhost/api/sources/verify', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }));
  return { status: res.status, json: (await res.json()) as Record<string, unknown> };
};

describe('POST /api/sources/verify', () => {
  it('checks every source in order and answers in the shared protocol', async () => {
    const { status, json } = await call({
      sources: [
        { url: 'https://www.notion.so/', subject: 'Notion' },
        { url: 'https://example.com/gone', title: 'Gone' },
        { url: 'https://intranet.example.com/wiki' },
        { url: 'file:///etc/passwd' },
      ],
    });
    expect(status).toBe(200);
    const parsed = SourceCheckResponseSchema.parse(json);
    expect(parsed.results.map((r) => [r.status, r.verified, r.detail ?? ''])).toEqual([
      ['title_match', true, ''],
      ['unreachable', false, 'HTTP 404'],
      ['blocked', false, 'private address 10.0.0.5'],
      ['blocked', false, 'non-http(s) scheme'],
    ]);
    expect(parsed.results[0].pageTitle).toBe('Notion – The all-in-one workspace');
  });

  it('rejects bodies that are not JSON, empty, too long or malformed', async () => {
    expect((await call('{')).status).toBe(400);
    expect((await call({ sources: [] })).status).toBe(400);
    expect((await call({ sources: Array.from({ length: 21 }, () => ({ url: 'https://a.example/' })) })).status).toBe(400);
    expect((await call({ sources: [{ url: 42 }] })).status).toBe(400);
    expect((await call({ sources: [{ url: `https://a.example/${'x'.repeat(2048)}` }] })).status).toBe(400);
  });
});
