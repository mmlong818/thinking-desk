import { describe, expect, it } from 'vitest';
import { LocalRepository } from '../model/local-repository';
import { memoryStorage } from '../model/__fixtures__/storage';
import { output, personaBody, rawJob, rawPersona, runInput, seqIdSource, T1 } from '../model/__fixtures__/model';
import { acceptRecommended, createItem, getGraph, listRuns, saveRun, updateItem } from './project-api';

// The /api/projects/[id]/* handlers run against LocalRepository here (same planners as
// PgRepository, no database): body validation, happy paths and error mapping.

const PID = 'proj-api';

function setup() {
  const repo = new LocalRepository({ storage: memoryStorage(), now: () => T1, idSource: seqIdSource() });
  return { repo };
}

const req = (method: string, body?: unknown) =>
  new Request('http://localhost/api/projects/x', { method, body: body === undefined ? undefined : JSON.stringify(body) });

async function json(res: Response | Promise<Response>) {
  const r = await res;
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

const runBody = output({
  run: runInput(),
  drafts: [
    { ref: 'p1', type: 'persona', body: rawPersona('p1'), aiStance: { verdict: 'recommend', reason: 'r' } },
    { ref: 'j1', type: 'job', body: rawJob('j1', ['p1']) },
  ],
  replace: [{ node: 'users', type: 'persona' }],
});

describe('POST runs (saveRunOutput)', () => {
  it('saves the run and its drafts, then GET graph / runs return them', async () => {
    const { repo } = setup();
    const saved = await json(saveRun(repo, PID, req('POST', runBody)));
    expect(saved.status).toBe(200);
    expect(saved.body.result).toMatchObject({ run: { status: 'ok' }, created: [{ type: 'persona' }, { type: 'job' }] });
    const graph = await json(getGraph(repo, PID));
    expect((graph.body.graph as { items: unknown[]; links: unknown[] }).items).toHaveLength(2);
    expect((graph.body.graph as { links: unknown[] }).links).toHaveLength(1);
    const runs = await json(listRuns(repo, PID, new URL('http://x/runs?node=users')));
    expect(runs.body.runs).toHaveLength(1);
    expect((await json(listRuns(repo, PID, new URL('http://x/runs?node=stake')))).body.runs).toHaveLength(0);
  });

  it('rejects a malformed run with 400 and writes nothing', async () => {
    const { repo } = setup();
    const bad = await json(saveRun(repo, PID, req('POST', { ...runBody, run: { ...runBody.run, task: 'NOPE' } })));
    expect(bad).toMatchObject({ status: 400, body: { error: 'invalid' } });
    expect((await repo.getGraph(PID)).items).toEqual([]);
    expect((await json(saveRun(repo, PID, new Request('http://x', { method: 'POST', body: '{' })))).status).toBe(400);
  });
});

describe('items', () => {
  it('creates a human item (accepted by default) and validates the body', async () => {
    const { repo } = setup();
    const ok = await json(createItem(repo, PID, req('POST', { node: 'users', type: 'persona', body: personaBody('人') })));
    expect(ok.body.item).toMatchObject({ origin: 'human', decision: 'accepted' });
    const bad = await json(createItem(repo, PID, req('POST', { node: 'users', type: 'persona', body: { name: 1 } })));
    expect(bad.status).toBe(400);
    const wrongNode = await json(createItem(repo, PID, req('POST', { node: 'stake', type: 'persona', body: personaBody() })));
    expect(wrongNode.status).toBe(400);
  });

  it('PATCH records human decisions with the note and maps unknown items to 404', async () => {
    const { repo } = setup();
    await saveRun(repo, PID, req('POST', runBody));
    const [persona] = (await repo.getGraph(PID)).items;
    const rejected = await json(updateItem(repo, PID, persona.id, req('PATCH', { patch: { decision: 'rejected', decisionNote: '太泛' } })));
    expect(rejected.body.item).toMatchObject({ decision: 'rejected', decisionNote: '太泛' });
    const events = await repo.listEvents(PID, { itemId: persona.id });
    expect(events.at(-1)).toMatchObject({ kind: 'rejected', actor: 'human', note: '太泛' });
    expect((await json(updateItem(repo, PID, 'nope', req('PATCH', { patch: { decision: 'accepted' } })))).status).toBe(404);
    expect((await json(updateItem(repo, PID, persona.id, req('PATCH', { patch: { decision: 'maybe' } })))).status).toBe(400);
  });

  it('cannot create a second singleton (409)', async () => {
    const { repo } = setup();
    const plan = { node: 'stake', type: 'engagement_plan', body: { manage: 'a', satisfy: 'b', inform: 'c', monitor: 'd' } };
    expect((await json(createItem(repo, PID, req('POST', plan)))).status).toBe(200);
    expect((await json(createItem(repo, PID, req('POST', plan)))).status).toBe(409);
  });
});

describe('POST accept-recommended', () => {
  it('accepts the recommended pending items of the node only', async () => {
    const { repo } = setup();
    await saveRun(repo, PID, req('POST', runBody));
    const res = await json(acceptRecommended(repo, PID, req('POST', { node: 'users' })));
    expect(res.body.items).toEqual([expect.objectContaining({ type: 'persona', decision: 'accepted' })]);
    expect((await json(acceptRecommended(repo, PID, req('POST', { node: 'nope' })))).status).toBe(400);
  });
});
