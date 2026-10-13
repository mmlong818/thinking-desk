import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { runTask, RunTaskError, type RunTaskDeps, type RunTaskSpec } from './run-task';
import type { TaskProgress } from './stream-protocol';
import type { AiProvider, CompleteRequest, CompleteResult, FinishReason } from './types';

// runTask() with onProgress against fake streaming providers: deltas, retry restarts, aborts,
// network errors and the fallback to complete(). No network.

const Out = z.object({ title: z.string().min(1) });
const VALID = ['{"title":', '"ok"}'];
const INVALID = ['{"title":', '""}'];

interface Script {
  chunks: string[];
  finishReason?: FinishReason;
  /** Throw this after the chunks (a network error mid-stream). */
  failAfter?: Error;
  /** After the chunks, wait until the request signal aborts. */
  hang?: boolean;
}

const tick = () => new Promise((r) => setTimeout(r, 1));

function streamer(...scripts: Script[]) {
  const requests: CompleteRequest[] = [];
  let completes = 0;
  const provider: AiProvider = {
    name: 'openai',
    isConfigured: () => true,
    listModels: async () => [],
    complete: async (model) => {
      completes += 1;
      return { text: VALID.join(''), provider: 'openai', model, latencyMs: 1, finishReason: 'stop' };
    },
    stream: async (model, req, onDelta): Promise<CompleteResult> => {
      requests.push(req);
      const s = scripts[Math.min(requests.length - 1, scripts.length - 1)];
      for (const c of s.chunks) {
        await tick();
        onDelta(c);
      }
      if (s.failAfter) throw s.failAfter;
      if (s.hang) await new Promise((_, reject) => req.signal?.addEventListener('abort', () => reject(new Error('fetch aborted'))));
      return {
        text: s.chunks.join(''), provider: 'openai', model, latencyMs: 2,
        usage: { inputTokens: 10, outputTokens: s.chunks.length }, finishReason: s.finishReason ?? 'stop',
      };
    },
  };
  const deps: RunTaskDeps = { resolve: async () => ({ provider, model: 'm-1' }), now: () => 0 };
  return { provider, requests, deps, completes: () => completes };
}

function spec(over: { signal?: AbortSignal; timeoutMs?: number; onProgress?: (e: TaskProgress) => void } = {}) {
  const events: TaskProgress[] = [];
  const s: RunTaskSpec & { schema: typeof Out } = {
    task: 'SCEN_FEED', system: 'S', messages: [{ role: 'user', content: 'hi' }], schema: Out,
    options: { onProgress: over.onProgress ?? ((e) => events.push(e)), signal: over.signal, timeoutMs: over.timeoutMs },
  };
  return { s, events };
}

const deltas = (events: TaskProgress[]): Array<[number, string]> =>
  events.flatMap((e) => (e.type === 'delta' ? [[e.attempt, e.text] as [number, string]] : []));

describe('runTask · streaming', () => {
  it('reports the attempt, then every delta, and returns the same validated result', async () => {
    const f = streamer({ chunks: VALID });
    const { s, events } = spec();
    const res = await runTask(s, f.deps);
    expect(res.data).toEqual({ title: 'ok' });
    expect(res.run).toMatchObject({ status: 'ok', attempts: 1, provider: 'openai', model: 'm-1', usage: { inputTokens: 10, outputTokens: 2 } });
    expect(events[0]).toEqual({ type: 'attempt', attempt: 1, provider: 'openai', model: 'm-1', streaming: true });
    expect(deltas(events)).toEqual([[1, '{"title":'], [1, '"ok"}']]);
    expect(f.completes()).toBe(0);
  });

  it('restarts the stream on invalid output: attempt 2 carries the reason, the retry request the errors', async () => {
    const f = streamer({ chunks: INVALID }, { chunks: VALID });
    const { s, events } = spec();
    const res = await runTask(s, f.deps);
    expect(res.run).toMatchObject({ status: 'retried', attempts: 2, usage: { inputTokens: 20, outputTokens: 4 } });
    const attempts = events.filter((e) => e.type === 'attempt');
    expect(attempts[1]).toMatchObject({ attempt: 2, retry: { code: 'invalid_output', issues: [expect.stringContaining('title')] } });
    expect(deltas(events).map(([n]) => n)).toEqual([1, 1, 2, 2]);
    expect(f.requests[1].messages.at(-2)).toEqual({ role: 'assistant', content: INVALID.join('') });
  });

  it('fails with invalid_output after the second invalid stream, and does not retry a truncated one', async () => {
    const twice = streamer({ chunks: INVALID });
    const e = await runTask(spec().s, twice.deps).catch((err: unknown) => err);
    expect(e).toBeInstanceOf(RunTaskError);
    expect(e).toMatchObject({ code: 'invalid_output', run: { status: 'failed', attempts: 2 } });
    const cut = streamer({ chunks: ['{"title":"o'], finishReason: 'length' });
    await expect(runTask(spec().s, cut.deps)).rejects.toMatchObject({ code: 'truncated' });
    expect(cut.requests).toHaveLength(1);
  });

  it('aborts mid-stream: the provider signal aborts, the task fails aborted, no progress after that', async () => {
    const ctrl = new AbortController();
    const f = streamer({ chunks: ['{"ti'], hang: true });
    const events: TaskProgress[] = [];
    const { s } = spec({ signal: ctrl.signal, onProgress: (e) => {
      events.push(e);
      if (e.type === 'delta') ctrl.abort();
    } });
    await expect(runTask(s, f.deps)).rejects.toMatchObject({ code: 'aborted', run: { status: 'failed' } });
    expect(f.requests[0].signal?.aborted).toBe(true);
    expect(events.map((e) => e.type)).toEqual(['attempt', 'delta']);
  });

  it('times out a stream that stalls', async () => {
    const f = streamer({ chunks: ['{'], hang: true });
    await expect(runTask(spec({ timeoutMs: 30 }).s, f.deps)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('classifies a network error mid-stream as a provider error and does not retry it', async () => {
    const f = streamer({ chunks: ['{"title"'], failAfter: new TypeError('terminated') });
    await expect(runTask(spec().s, f.deps)).rejects.toMatchObject({ code: 'provider', message: 'terminated' });
    expect(f.requests).toHaveLength(1);
  });

  it('falls back to complete() for a provider without stream(), and never streams without onProgress', async () => {
    const f = streamer({ chunks: VALID });
    const noStream: AiProvider = { ...f.provider, stream: undefined };
    const { s, events } = spec();
    await runTask(s, { ...f.deps, resolve: async () => ({ provider: noStream, model: 'm-1' }) });
    expect(events).toEqual([{ type: 'attempt', attempt: 1, provider: 'openai', model: 'm-1', streaming: false }]);
    await runTask({ ...s, options: {} }, f.deps);
    expect(f.completes()).toBe(2);
    expect(f.requests).toHaveLength(0);
  });

  it('keeps going when a progress listener throws', async () => {
    const f = streamer({ chunks: VALID });
    const res = await runTask(spec({ onProgress: () => { throw new Error('listener bug'); } }).s, f.deps);
    expect(res.data).toEqual({ title: 'ok' });
  });
});
