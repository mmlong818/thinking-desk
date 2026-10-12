import { describe, expect, it } from 'vitest';
import { adaptUsersAnalysis } from '../model/adapters';
import { LocalRepository } from '../model/local-repository';
import { memoryStorage } from '../model/__fixtures__/storage';
import { seqIdSource, T1 } from '../model/__fixtures__/model';
import { UsersAnalysisSchema, type UsersAnalysis } from '../ai/schemas/analyze-users';
import { validUsers } from '../ai/schemas/__fixtures__/users';
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
    expect((await t.repo.listRuns(PID)).map((r) => r.status)).toEqual(['failed']);
    expect((await t.repo.getGraph(PID)).items).toEqual([]);
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
