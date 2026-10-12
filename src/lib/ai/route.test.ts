import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { aiRoute, RouteError } from './route';
import { RunTaskError, type RunMeta, type RunTaskResult, type TaskOptions } from './run-task';

const run: RunMeta = {
  task: 'FREE_ASK', provider: 'claude', model: 'm', promptVersion: 'sha256:x', status: 'ok', attempts: 1, latencyMs: 3,
};
const Body = z.object({ q: z.string().min(1), model: z.string().optional() });
const post = (body: unknown, init: RequestInit = {}) =>
  new Request('http://localhost/api/ai/x', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), ...init });

function route(handle: (body: z.output<typeof Body>, opts: TaskOptions) => Promise<RunTaskResult<unknown>>) {
  return aiRoute({ name: 'x', body: Body, timeoutMs: 1234, handle });
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('aiRoute', () => {
  it('answers { ok, data, run } and passes the model override, signal and deadline to the task', async () => {
    const handle = vi.fn(async () => ({ data: { a: 1 }, text: '', run }));
    const ctrl = new AbortController();
    const res = await route(handle)(post({ q: 'hi', model: 'claude:m' }, { signal: ctrl.signal }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { a: 1 }, run });
    const [body, opts] = handle.mock.calls[0] as unknown as [unknown, TaskOptions];
    expect(body).toEqual({ q: 'hi', model: 'claude:m' });
    expect(opts).toMatchObject({ model: 'claude:m', timeoutMs: 1234 });
    expect(opts.signal).toBeInstanceOf(AbortSignal);
  });

  it('rejects malformed JSON and schema violations with 400 "invalid body" without calling the task', async () => {
    const handle = vi.fn();
    for (const body of ['{oops', { q: '' }]) {
      const res = await route(handle)(post(body));
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('invalid body');
      expect(typeof json.detail).toBe('string');
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it('maps RouteError to its status, code and detail', async () => {
    const res = await route(async () => { throw new RouteError(400, 'missing_brief', '需要 Brief 上下文'); })(post({ q: 'a' }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'missing_brief', detail: '需要 Brief 上下文' });
  });

  it('maps RunTaskError to ai_failed with its code (504 on timeout) and run metadata', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = { ...run, status: 'failed' as const, error: 'timeout: AI call timed out' };
    const res = await route(async () => { throw new RunTaskError('timeout', 'AI call timed out', failed); })(post({ q: 'a' }));
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'ai_failed', code: 'timeout', run: failed, detail: 'AI call timed out' });
  });

  it('hides provider error text in production', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubEnv('NODE_ENV', 'production');
    const failed = { ...run, status: 'failed' as const, error: 'provider: OpenAI 401: key sk-…' };
    const res = await route(async () => { throw new RunTaskError('provider', 'OpenAI 401: key sk-…', failed); })(post({ q: 'a' }));
    const json = await res.json();
    expect(res.status).toBe(502);
    expect(json).not.toHaveProperty('detail');
    expect(json.run).not.toHaveProperty('error');
    expect(JSON.stringify(json)).not.toContain('sk-');
  });
});
