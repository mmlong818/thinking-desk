import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { readNdjson } from './__fixtures__/streams';
import { aiRoute, RouteError } from './route';
import { runTask, RunTaskError, type RunMeta, type RunTaskDeps, type RunTaskResult, type TaskOptions } from './run-task';
import { NDJSON_TYPE, StreamEventSchema } from './stream-protocol';
import type { AiProvider } from './types';

// aiRoute() with `stream: true`: NDJSON progress for clients that ask, the same final body as
// the JSON answer, error events, and aborts reaching the task. No network.

const run: RunMeta = { task: 'SCEN_FEED', provider: 'openai', model: 'm', promptVersion: 'sha256:x', status: 'ok', attempts: 1, latencyMs: 3 };
const Body = z.object({ q: z.string(), model: z.string().optional() });
type Handle = (body: z.output<typeof Body>, opts: TaskOptions) => Promise<RunTaskResult<unknown>>;

const route = (handle: Handle, stream = true) => aiRoute({ name: 'x', body: Body, timeoutMs: 5_000, stream, handle });
const post = (accept?: string, signal?: AbortSignal) => new Request('http://localhost/api/ai/x', {
  method: 'POST', body: JSON.stringify({ q: 'hi' }), headers: accept ? { accept } : {}, signal,
});

afterEach(() => vi.restoreAllMocks());

describe('aiRoute · NDJSON streaming', () => {
  it('streams attempt / delta events and ends with the JSON answer as a done event', async () => {
    const handle: Handle = async (_b, opts) => {
      opts.onProgress?.({ type: 'attempt', attempt: 1, provider: 'openai', model: 'm', streaming: true });
      opts.onProgress?.({ type: 'delta', attempt: 1, text: '{"a":1}' });
      return { data: { a: 1 }, text: '{"a":1}', run };
    };
    const res = await route(handle)(post(NDJSON_TYPE));
    expect(res.headers.get('content-type')).toContain(NDJSON_TYPE);
    const events = await readNdjson(res.body);
    expect(events.map((e) => StreamEventSchema.parse(e).type)).toEqual(['attempt', 'delta', 'done']);
    const json = await (await route(handle)(post())).json();
    const { type: _t, ...done } = events[2] as Record<string, unknown>;
    expect(done).toEqual(json);
  });

  it('answers JSON when the client does not ask for NDJSON, or the route does not stream', async () => {
    const handle: Handle = async () => ({ data: 1, text: '', run });
    for (const res of [await route(handle)(post()), await route(handle, false)(post(NDJSON_TYPE))]) {
      expect(res.headers.get('content-type')).toContain('application/json');
      expect(await res.json()).toEqual({ ok: true, data: 1, run });
    }
  });

  it('ends with an error event carrying the HTTP status and body a JSON answer would have', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = { ...run, status: 'failed' as const, error: 'timeout: AI call timed out' };
    const timeout = await readNdjson((await route(async () => { throw new RunTaskError('timeout', 'AI call timed out', failed); })(post(NDJSON_TYPE))).body);
    expect(timeout).toEqual([{ type: 'error', status: 504, error: 'ai_failed', code: 'timeout', run: failed, detail: 'AI call timed out' }]);
    const missing = await readNdjson((await route(async () => { throw new RouteError(400, 'missing_brief', '需要 Brief'); })(post(NDJSON_TYPE))).body);
    expect(missing).toEqual([{ type: 'error', status: 400, error: 'missing_brief', detail: '需要 Brief' }]);
  });

  it('aborts the task when the client cancels the body or the request is aborted', async () => {
    const seen: AbortSignal[] = [];
    const handle: Handle = (_b, opts) => new Promise((_, reject) => {
      seen.push(opts.signal as AbortSignal);
      opts.onProgress?.({ type: 'attempt', attempt: 1, provider: 'openai', model: 'm', streaming: true });
      opts.signal?.addEventListener('abort', () => reject(new RunTaskError('aborted', 'AI call aborted by the caller', run)));
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const reader = (await route(handle)(post(NDJSON_TYPE))).body!.getReader();
    await reader.read();
    await reader.cancel();
    expect(seen[0].aborted).toBe(true);
    const ctrl = new AbortController();
    const res = await route(handle)(post(NDJSON_TYPE, ctrl.signal));
    ctrl.abort();
    expect(await readNdjson(res.body)).toContainEqual(expect.objectContaining({ type: 'error', status: 499, code: 'aborted' }));
    expect(seen[1].aborted).toBe(true);
  });
});

describe('aiRoute · streaming end to end through runTask', () => {
  const Out = z.object({ title: z.string().min(1) });
  function provider(answers: string[][]): { p: AiProvider; signals: (AbortSignal | undefined)[] } {
    const signals: (AbortSignal | undefined)[] = [];
    const p: AiProvider = {
      name: 'claude', isConfigured: () => true, listModels: async () => [],
      complete: async () => { throw new Error('not used'); },
      stream: async (model, req, onDelta) => {
        signals.push(req.signal);
        const chunks = answers[Math.min(signals.length - 1, answers.length - 1)];
        chunks.forEach(onDelta);
        return { text: chunks.join(''), provider: 'claude', model, latencyMs: 1, usage: { inputTokens: 3, outputTokens: 2 }, finishReason: 'stop' };
      },
    };
    return { p, signals };
  }
  const handleWith = (p: AiProvider): Handle => (_b, opts) => {
    const deps: RunTaskDeps = { resolve: async () => ({ provider: p, model: 'claude-sonnet-5-5' }), now: () => 0 };
    return runTask({ task: 'SCEN_FEED', system: 'S', messages: [], schema: Out, options: opts }, deps);
  };

  it('restarts after invalid output and ends with the validated data and retried run metadata', async () => {
    const { p } = provider([['{"title":', '""}'], ['{"title":', '"情景"}']]);
    const events = (await readNdjson((await route(handleWith(p))(post(NDJSON_TYPE))).body)).map((e) => StreamEventSchema.parse(e));
    expect(events.map((e) => e.type)).toEqual(['attempt', 'delta', 'delta', 'attempt', 'delta', 'delta', 'done']);
    expect(events[3]).toMatchObject({ attempt: 2, retry: { code: 'invalid_output' } });
    expect(events.at(-1)).toMatchObject({ type: 'done', ok: true, data: { title: '情景' }, run: { status: 'retried', attempts: 2, usage: { inputTokens: 6, outputTokens: 4 } } });
  });
});
