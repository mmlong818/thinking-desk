import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RunSchema } from '../model/types';
import { DATA_GUARD, READER_RULE } from './prompt';
import { promptVersionOf, runTask, RunTaskError, toRunInput, type RunTaskDeps, type RunTaskSpec } from './run-task';
import type { AiProvider, CompleteRequest, CompleteResult } from './types';

const Out = z.object({ title: z.string().min(1), tags: z.array(z.string()).max(2) });
const VALID = JSON.stringify({ title: 'ok', tags: ['a'] });
const INVALID = JSON.stringify({ title: '', tags: ['a', 'b', 'c'] });

type Reply = Partial<CompleteResult> | ((req: CompleteRequest) => Promise<CompleteResult>);

/** Fake provider answering from a script of replies; records every request. */
function fake(...replies: Reply[]) {
  const requests: CompleteRequest[] = [];
  const provider: AiProvider = {
    name: 'claude',
    isConfigured: () => true,
    listModels: async () => [],
    complete: async (model, req) => {
      requests.push(req);
      const reply = replies[Math.min(requests.length - 1, replies.length - 1)];
      if (typeof reply === 'function') return reply(req);
      return { text: VALID, provider: 'claude', model, latencyMs: 5, usage: { inputTokens: 10, outputTokens: 4 }, finishReason: 'stop', ...reply };
    },
  };
  let t = 1_000;
  const deps: RunTaskDeps = { resolve: async () => ({ provider, model: 'm-1' }), now: () => (t += 50) };
  return { provider, requests, deps };
}

const spec = (over: Partial<Omit<RunTaskSpec, 'schema'>> = {}): RunTaskSpec & { schema: typeof Out } => ({
  task: 'BRIEF_EXTRACT', system: 'SYSTEM', messages: [{ role: 'user', content: 'hi' }], schema: Out, maxTokens: 1000, ...over,
});

const failure = async (p: Promise<unknown>): Promise<RunTaskError> => {
  const e = await p.then(() => null, (err: unknown) => err);
  expect(e).toBeInstanceOf(RunTaskError);
  return e as RunTaskError;
};

describe('runTask · success and retry', () => {
  it('returns parsed data and run metadata on the first valid answer', async () => {
    const f = fake({});
    const res = await runTask(spec(), f.deps);
    expect(res.data).toEqual({ title: 'ok', tags: ['a'] });
    expect(res.run).toMatchObject({
      task: 'BRIEF_EXTRACT', provider: 'claude', model: 'm-1', status: 'ok', attempts: 1,
      usage: { inputTokens: 10, outputTokens: 4 }, latencyMs: 50,
    });
    expect(res.run.promptVersion).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(res.run.retry).toBeUndefined();
  });

  it('sends the JSON Schema built from the Zod schema and appends the data guard to the system prompt', async () => {
    const f = fake({});
    await runTask(spec(), f.deps);
    const [req] = f.requests;
    const { $schema: _dialect, ...expected } = z.toJSONSchema(Out, { io: 'output' });
    expect(req.schema).toEqual(expected);
    expect(req.schema).toMatchObject({ type: 'object', required: ['title', 'tags'], additionalProperties: false });
    expect(req.messages[0]).toEqual({ role: 'system', content: `SYSTEM\n\n${READER_RULE}\n\n${DATA_GUARD}` });
    expect(req.messages[1]).toEqual({ role: 'user', content: 'hi' });
    expect(req.maxTokens).toBe(1000);
    expect(req.signal).toBeInstanceOf(AbortSignal);
  });

  it('retries once with the validation errors fed back, then reports status retried', async () => {
    const f = fake({ text: INVALID }, {});
    const res = await runTask(spec(), f.deps);
    expect(res.run).toMatchObject({ status: 'retried', attempts: 2, usage: { inputTokens: 20, outputTokens: 8 } });
    const retry = f.requests[1].messages;
    expect(retry.at(-2)).toEqual({ role: 'assistant', content: INVALID });
    expect(retry.at(-1)?.role).toBe('user');
    expect(retry.at(-1)?.content).toContain('title:');
    expect(retry.at(-1)?.content).toContain('tags:');
    expect(res.run.retry?.code).toBe('invalid_output');
    expect(res.run.retry?.issues.some((x) => x.startsWith('title:'))).toBe(true);
    expect(res.run.retry?.issues.some((x) => x.startsWith('tags:'))).toBe(true);
  });

  it('treats non-JSON text as invalid output and retries', async () => {
    const f = fake({ text: 'Sure! here you go' }, { text: `\`\`\`json\n${VALID}\n\`\`\`` });
    const res = await runTask(spec(), f.deps);
    expect(res.run.status).toBe('retried');
    expect(f.requests[1].messages.at(-1)?.content).toContain('输出不是合法 JSON');
  });

  it('returns the raw text for a schema-less task', async () => {
    const f = fake({ text: 'free answer' });
    const res = await runTask({ task: 'FREE_ASK', system: 's', messages: [] }, f.deps);
    expect(res.data).toBe('free answer');
    expect(f.requests[0].schema).toBeUndefined();
  });
});

describe('runTask · failures', () => {
  it('fails with invalid_output after the second invalid answer', async () => {
    const f = fake({ text: INVALID });
    const e = await failure(runTask(spec(), f.deps));
    expect(e.code).toBe('invalid_output');
    expect(e.issues.length).toBeGreaterThan(0);
    expect(e.run).toMatchObject({ status: 'failed', attempts: 2 });
    expect(e.run.error).toMatch(/^invalid_output: /);
    expect(e.run.retry).toMatchObject({ code: 'invalid_output', issues: expect.arrayContaining([expect.stringMatching(/^title:/)]) });
    expect(f.requests).toHaveLength(2);
  });

  it('does not retry a truncated answer', async () => {
    const f = fake({ text: '{"title": "o', finishReason: 'length' });
    const e = await failure(runTask(spec(), f.deps));
    expect(e.code).toBe('truncated');
    expect(f.requests).toHaveLength(1);
  });

  it('does not retry a provider safety refusal', async () => {
    const f = fake({ text: '', finishReason: 'refusal' });
    expect((await failure(runTask(spec(), f.deps))).code).toBe('refused');
    expect(f.requests).toHaveLength(1);
  });

  it('classifies provider errors and does not retry them', async () => {
    const f = fake(async () => { throw new Error('Gemini 500: boom'); });
    const e = await failure(runTask(spec(), f.deps));
    expect(e).toMatchObject({ code: 'provider', message: 'Gemini 500: boom' });
    expect(f.requests).toHaveLength(1);
  });

  it('refuses a structured task on a model the adapter cannot drive, before any provider call', async () => {
    const f = fake({});
    f.provider.canDrive = (id) => id !== 'm-1';
    const e = await failure(runTask(spec(), f.deps));
    expect(e.code).toBe('config');
    expect(e.message).toMatch(/cannot run structured/);
    expect(f.requests).toHaveLength(0);
    const free = await runTask({ task: 'FREE_ASK', system: 's', messages: [] }, f.deps);
    expect(free.data).toBe(VALID);
  });

  it('classifies routing errors as config', async () => {
    const deps: RunTaskDeps = { resolve: async () => { throw new Error('No AI provider configured.'); }, now: () => 0 };
    const e = await failure(runTask(spec(), deps));
    expect(e.code).toBe('config');
    expect(e.run).toMatchObject({ provider: '', status: 'failed' });
  });
});

describe('runTask · deadline', () => {
  const hang = (req: CompleteRequest) => new Promise<CompleteResult>(() => { void req; });

  it('times out even when the provider ignores the signal, and aborts the provider signal', async () => {
    const f = fake(hang);
    const e = await failure(runTask(spec({ options: { timeoutMs: 20 } }), f.deps));
    expect(e.code).toBe('timeout');
    expect(e.run.status).toBe('failed');
    expect(f.requests[0].signal?.aborted).toBe(true);
  });

  it('propagates the caller abort to the provider', async () => {
    const ctrl = new AbortController();
    const f = fake((req) => new Promise<CompleteResult>((_, reject) => {
      req.signal?.addEventListener('abort', () => reject(new Error('fetch aborted')));
      setTimeout(() => ctrl.abort(), 5);
    }));
    const e = await failure(runTask(spec({ options: { signal: ctrl.signal, timeoutMs: 5_000 } }), f.deps));
    expect(e.code).toBe('aborted');
  });

  it('does not call the provider when the caller already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const f = fake({});
    const e = await failure(runTask(spec({ options: { signal: ctrl.signal } }), f.deps));
    expect(e.code).toBe('aborted');
    expect(f.requests).toHaveLength(0);
  });

  it('hands the provider the time left as timeoutMs', async () => {
    const f = fake({});
    await runTask(spec({ options: { timeoutMs: 60_000 } }), f.deps);
    expect(f.requests[0].timeoutMs).toBeGreaterThan(50_000);
    expect(f.requests[0].timeoutMs).toBeLessThanOrEqual(60_000);
  });
});

describe('promptVersion / toRunInput', () => {
  it('is stable for the same template and changes with the template or schema', () => {
    const a = promptVersionOf('S', { type: 'object' });
    expect(promptVersionOf('S', { type: 'object' })).toBe(a);
    expect(promptVersionOf('S2', { type: 'object' })).not.toBe(a);
    expect(promptVersionOf('S', { type: 'array' })).not.toBe(a);
  });

  it('maps run metadata onto a valid Run record, ok or failed', async () => {
    const ok = await runTask(spec(), fake({}).deps);
    const failed = await failure(runTask(spec(), fake({ text: INVALID }).deps));
    for (const meta of [ok.run, failed.run]) {
      const input = toRunInput(meta, { node: 'brief', inputs: [{ itemId: 'brf_1', version: 2 }] });
      const run = RunSchema.safeParse({ ...input, id: 'run_1', projectId: 'p', createdAt: '2026-10-13T00:00:00.000Z' });
      expect(run.success).toBe(true);
    }
    expect(toRunInput(failed.run, { node: 'brief' })).toMatchObject({ status: 'failed', error: expect.stringMatching(/^invalid_output/) });
  });

  it('keeps why a run was retried on the Run record', async () => {
    const retried = await runTask(spec(), fake({ text: INVALID }, {}).deps);
    const input = toRunInput(retried.run, { node: 'brief' });
    expect(input).toMatchObject({ status: 'retried', retry: { code: 'invalid_output' } });
    expect(input.retry?.issues.length).toBeGreaterThan(0);
    expect(RunSchema.safeParse({ ...input, id: 'run_1', projectId: 'p', createdAt: '2026-10-13T00:00:00.000Z' }).success).toBe(true);
    expect(toRunInput((await runTask(spec(), fake({}).deps)).run, { node: 'brief' })).not.toHaveProperty('retry');
  });
});
