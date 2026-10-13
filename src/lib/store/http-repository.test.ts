import { describe, expect, it } from 'vitest';
import { RepositoryError } from '../model/repository';
import { output } from '../model/__fixtures__/model';
import { HttpRepository } from './http-repository';

function fakeFetch(answer: { status?: number; body: unknown }) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetch = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200 });
  };
  return { fetch, calls };
}

describe('HttpRepository', () => {
  it('maps every call onto /api/projects/[id]/*', async () => {
    const f = fakeFetch({ body: { ok: true, graph: { items: [], links: [] }, runs: [], result: {}, item: {}, items: [] } });
    const repo = new HttpRepository(f.fetch);
    await repo.getGraph('p 1');
    await repo.listRuns('p1', { node: 'users' });
    await repo.saveRunOutput('p1', output());
    await repo.updateItem('p1', 'per_1', { decision: 'rejected', decisionNote: 'n' }, { actor: 'human', note: 'x' });
    await repo.createItem('p1', { node: 'users', type: 'persona', body: {} });
    await repo.acceptRecommended('p1', 'users');
    expect(f.calls.map((c) => `${c.init?.method ?? 'GET'} ${c.url}`)).toEqual([
      'GET /api/projects/p%201/graph',
      'GET /api/projects/p1/runs?node=users',
      'POST /api/projects/p1/runs',
      'PATCH /api/projects/p1/items/per_1',
      'POST /api/projects/p1/items',
      'POST /api/projects/p1/accept-recommended',
    ]);
    expect(JSON.parse(String(f.calls[3].init?.body))).toEqual({ patch: { decision: 'rejected', decisionNote: 'n' }, note: 'x' });
  });

  it('turns error answers into RepositoryError with the server code', async () => {
    const repo = new HttpRepository(fakeFetch({ status: 409, body: { error: 'conflict', detail: 'already has a brief' } }).fetch);
    const e = await repo.getGraph('p1').catch((err: unknown) => err);
    expect(e).toBeInstanceOf(RepositoryError);
    expect(e).toMatchObject({ code: 'conflict', message: 'already has a brief' });
    const down = new HttpRepository(fakeFetch({ status: 503, body: { error: 'db_unavailable' } }).fetch);
    await expect(down.getGraph('p1')).rejects.toMatchObject({ code: 'storage', message: 'db_unavailable' });
  });
});
