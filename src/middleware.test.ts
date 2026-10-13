import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { middleware } from './middleware';

const hit = (path: string, ip: string) =>
  middleware(new NextRequest(`http://localhost${path}`, { method: 'POST', headers: { 'x-forwarded-for': ip } }));

describe('middleware rate limit', () => {
  it('limits /api/sources/* per IP (default 20 per window), separately from /api/ai/*', () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < 20; i++) expect(hit('/api/sources/verify', ip).status).not.toBe(429);
    const limited = hit('/api/sources/verify', ip);
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBeTruthy();
    expect(hit('/api/ai/free-ask', ip).status).not.toBe(429);
    expect(hit('/api/sources/verify', '203.0.113.8').status).not.toBe(429);
  });

  it('does not limit project data routes', () => {
    for (let i = 0; i < 25; i++) expect(hit('/api/projects/x/graph', '203.0.113.9').status).not.toBe(429);
  });
});
