import { describe, expect, it } from 'vitest';
import { adaptUsersAnalysis } from '../model/adapters';
import { LocalRepository } from '../model/local-repository';
import { memoryStorage } from '../model/__fixtures__/storage';
import { seqIdSource, T1 } from '../model/__fixtures__/model';
import { UsersAnalysisSchema, type UsersAnalysis } from '../ai/schemas/analyze-users';
import { validUsers } from '../ai/schemas/__fixtures__/users';
import { byteStream } from '../ai/__fixtures__/streams';
import { runAiAction } from './ai-action';

const PID = 'proj-ai';
const run = { task: 'USERS_JTBD', provider: 'claude', model: 'm', promptVersion: 'sha256:x', status: 'ok', attempts: 1, latencyMs: 12.4 };

function deps(answer: { status?: number; body: unknown } | Error) {
  const repo = new LocalRepository({ storage: memoryStorage(), now: () => T1, idSource: seqIdSource() });
  const sent: unknown[] = [];
  const fetch = async (_url: string, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    if (answer instanceof Error) throw answer;
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  };
  return { repo, sent, d: { fetch, repo, projectId: PID } };
}

const spec = {
  route: '/api/ai/analyze-users',
  body: { projectSlug: 'x' },
  node: 'users' as const,
  inputs: [{ itemId: 'brf_1', version: 2 }],
  adapt: (data: UsersAnalysis) => adaptUsersAnalysis(UsersAnalysisSchema.parse(data)),
};

describe('runAiAction', () => {
  it('saves the run with its inputs and the adapted items', async () => {
    const t = deps({ body: { ok: true, data: validUsers, run } });
    const out = await runAiAction(t.d, spec);
    expect(out.ok).toBe(true);
    const [saved] = await t.repo.listRuns(PID);
    expect(saved).toMatchObject({ task: 'USERS_JTBD', node: 'users', inputs: [{ itemId: 'brf_1', version: 2 }], latencyMs: 12 });
    expect((await t.repo.getGraph(PID)).items.map((i) => i.type)).toEqual(['persona', 'job', 'job', 'summary']);
    expect(t.sent).toEqual([{ projectSlug: 'x' }]);
  });

  it('records a failed AI call as a failed run and changes nothing else', async () => {
    const t = deps({ status: 504, body: { error: 'ai_failed', code: 'timeout', run: { ...run, status: 'failed' } } });
    const out = await runAiAction(t.d, spec);
    expect(out).toEqual({ ok: false, aborted: false, message: 'AI 响应超时，请稍后重试' });
    expect((await t.repo.listRuns(PID)).map((r) => [r.status, r.error])).toEqual([['failed', 'timeout: ai_failed']]);
    expect((await t.repo.getGraph(PID)).items).toEqual([]);
  });

  it('leads with what the error code means and keeps the provider detail after it', async () => {
    const t = deps({ status: 502, body: { error: 'ai_failed', code: 'provider', detail: 'fetch failed', run: { ...run, status: 'failed' } } });
    expect(await runAiAction(t.d, spec)).toEqual({
      ok: false, aborted: false, message: 'AI 服务调用失败（检查网络 / 代理 / API key）：fetch failed',
    });
  });

  it('reports output without usable items as a failure (the run is recorded failed)', async () => {
    const t = deps({ body: { ok: true, data: validUsers, run } });
    const out = await runAiAction(t.d, { ...spec, adapt: () => ({ drafts: [], replace: [{ node: 'users', type: 'persona' }] }) });
    expect(out).toMatchObject({ ok: false, message: expect.stringContaining('没有可用条目') });
  });

  it('records process steps without drafts, and surfaces network errors and aborts', async () => {
    const ok = deps({ body: { ok: true, data: { action: 'proceed', reason: 'r' }, run: { ...run, task: 'BRIEF_CLARIFY' } } });
    expect((await runAiAction(ok.d, { ...spec, adapt: undefined, node: 'brief' })).ok).toBe(true);
    expect(await ok.repo.listRuns(PID)).toHaveLength(1);
    const down = deps(new Error('fetch failed'));
    expect(await runAiAction(down.d, spec)).toEqual({ ok: false, aborted: false, message: 'fetch failed' });
    const aborted = deps(new DOMException('aborted', 'AbortError'));
    expect(await runAiAction(aborted.d, spec)).toMatchObject({ ok: false, aborted: true });
  });
});

describe('runAiAction · streamed answers', () => {
  const ndjson = (...events: unknown[]) => events.map((e) => `${JSON.stringify(e)}\n`);
  const attempt = { type: 'attempt', attempt: 1, provider: 'claude', model: 'm', streaming: true };

  function streaming(chunks: ReadonlyArray<string | Error>, hangUntil?: AbortSignal) {
    const repo = new LocalRepository({ storage: memoryStorage(), now: () => T1, idSource: seqIdSource() });
    const accepts: (string | null)[] = [];
    const progress: unknown[] = [];
    const fetch = async (_url: string, init?: RequestInit) => {
      accepts.push(new Headers(init?.headers).get('accept'));
      return new Response(byteStream(chunks, { hangUntil }), { headers: { 'content-type': 'application/x-ndjson; charset=utf-8' } });
    };
    return { repo, accepts, progress, d: { fetch, repo, projectId: PID, onProgress: (e: unknown) => progress.push(e) } };
  }

  it('asks for NDJSON, reports progress, then saves the final answer like a JSON one', async () => {
    const delta = { type: 'delta', attempt: 1, text: '{"personas":' };
    const t = streaming(ndjson(attempt, delta, { type: 'done', ok: true, data: validUsers, run }));
    const out = await runAiAction(t.d, { ...spec, stream: true });
    expect(out.ok).toBe(true);
    expect(t.accepts).toEqual(['application/x-ndjson']);
    expect(t.progress).toEqual([attempt, delta]);
    expect((await t.repo.getGraph(PID)).items.map((i) => i.type)).toEqual(['persona', 'job', 'job', 'summary']);
  });

  it('turns an error event into the same failure (recorded run, code message)', async () => {
    const t = streaming(ndjson(attempt, { type: 'error', status: 502, error: 'ai_failed', code: 'invalid_output', run: { ...run, status: 'failed', attempts: 2 } }));
    const out = await runAiAction(t.d, { ...spec, stream: true });
    expect(out).toEqual({ ok: false, aborted: false, message: 'AI 输出格式不合规（已自动重试一次）' });
    expect((await t.repo.listRuns(PID)).map((r) => r.status)).toEqual(['failed']);
  });

  it('reports a stream that breaks off without a final event, and an abort mid-stream', async () => {
    const cut = streaming([...ndjson(attempt), new TypeError('network error')]);
    expect(await runAiAction(cut.d, { ...spec, stream: true })).toEqual({ ok: false, aborted: false, message: 'network error' });
    const ended = streaming(ndjson(attempt));
    expect(await runAiAction(ended.d, { ...spec, stream: true })).toMatchObject({ ok: false, message: expect.stringContaining('流中断') });
    const ctrl = new AbortController();
    const aborted = streaming(ndjson(attempt), ctrl.signal);
    const p = runAiAction({ ...aborted.d, signal: ctrl.signal, onProgress: () => ctrl.abort() }, { ...spec, stream: true });
    expect(await p).toMatchObject({ ok: false, aborted: true });
    expect(await aborted.repo.listRuns(PID)).toEqual([]);
  });

  it('does not ask for NDJSON unless the action streams', async () => {
    const t = streaming(ndjson({ type: 'done', ok: true, data: validUsers, run }));
    await runAiAction(t.d, spec);
    expect(t.accepts).toEqual([null]);
  });
});
