import { describe, expect, it, vi } from 'vitest';
import { LOCAL_DOC_VERSION } from './local-doc';
import {
  LocalRepository, localBackupKey, localProjectId, localProjectKey, type LocalRepositoryOptions,
} from './local-repository';
import { RepositoryError, type ItemDraft } from './repository';
import {
  briefBody, jobBody, output, personaBody, PROJECT, rawJob, rawPersona, runInput, seqIdSource, T0,
} from './__fixtures__/model';
import { memoryStorage } from './__fixtures__/storage';

function setup(opts: Partial<LocalRepositoryOptions> = {}) {
  const storage = memoryStorage();
  const repo = new LocalRepository({ storage, now: () => T0, idSource: seqIdSource(), ...opts });
  return { storage, repo };
}

const usersRun = (drafts: ItemDraft[] = [
  { ref: 'p1', type: 'persona' as const, body: rawPersona('p1') },
  { ref: 'j1', type: 'job' as const, body: rawJob('j1', ['p1']) },
]) => output({ drafts, replace: [{ node: 'users', type: 'persona' }, { node: 'users', type: 'job' }] });

describe('LocalRepository', () => {
  it('round-trips a run output through one storage key per project', async () => {
    const { storage, repo } = setup();
    const res = await repo.saveRunOutput(PROJECT, usersRun());
    expect([...storage.data.keys()]).toEqual([localProjectKey(PROJECT)]);
    expect(JSON.parse(storage.data.get(localProjectKey(PROJECT)) ?? '{}').v).toBe(LOCAL_DOC_VERSION);

    const fresh = new LocalRepository({ storage });
    const graph = await fresh.getGraph(PROJECT);
    expect(graph.items).toEqual(res.created);
    expect(graph.links).toEqual(res.links);
    expect(await fresh.listRuns(PROJECT)).toEqual([res.run]);
    expect((await fresh.listEvents(PROJECT)).map((e) => e.kind)).toEqual(['created', 'created']);
  });

  it('keeps projects isolated', async () => {
    const { repo } = setup();
    await repo.saveRunOutput(PROJECT, usersRun());
    expect(await repo.listItems('other')).toEqual([]);
  });

  it('saveRunOutput is atomic: a failed write leaves storage untouched', async () => {
    const { storage, repo } = setup();
    await repo.saveRunOutput(PROJECT, usersRun());
    const before = storage.data.get(localProjectKey(PROJECT));
    storage.failWrites = true;
    const err = await repo.saveRunOutput(PROJECT, usersRun()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RepositoryError);
    expect((err as RepositoryError).code).toBe('storage');
    expect(storage.data.get(localProjectKey(PROJECT))).toBe(before);
  });

  it('applies regeneration semantics across runs', async () => {
    const { repo } = setup();
    const first = await repo.saveRunOutput(PROJECT, usersRun([
      { ref: 'p1', type: 'persona', body: rawPersona('p1') },
      { ref: 'p2', type: 'persona', body: rawPersona('p2') },
      { ref: 'j1', type: 'job', body: rawJob('j1', ['p1']) },
    ]));
    const [persona, pendingPersona, job] = first.created;
    await repo.updateItem(PROJECT, persona.id, { decision: 'accepted' }, { actor: 'human' });
    await repo.updateItem(PROJECT, job.id, { decision: 'rejected' }, { actor: 'human' });
    const second = await repo.saveRunOutput(PROJECT, usersRun([
      { ref: 'p9', type: 'persona', body: rawPersona('p9', 'New') },
      { ref: 'j9', type: 'job', body: rawJob('j9', ['p9']) },
    ]));
    expect(second.retired).toEqual([pendingPersona.id]);
    const live = await repo.listItems(PROJECT);
    expect(live.map((i) => i.id)).toEqual([persona.id, job.id, ...second.created.map((i) => i.id)]);
    expect((await repo.getGraph(PROJECT)).links.map((l) => [l.from, l.to])).toEqual([
      [job.id, persona.id], [second.created[1].id, second.created[0].id],
    ]);
  });

  it('records a run without valid output as failed and keeps the pending items it would replace', async () => {
    const { repo } = setup();
    const first = await repo.saveRunOutput(PROJECT, usersRun());
    const second = await repo.saveRunOutput(PROJECT, usersRun([{ type: 'persona', body: { name: 1 } }]));
    expect(second.run).toMatchObject({ status: 'failed', error: 'run produced no valid items (1 drafts rejected)' });
    expect(second.retired).toEqual([]);
    expect((await repo.listItems(PROJECT)).map((i) => i.id)).toEqual(first.created.map((i) => i.id));
    expect((await repo.listRuns(PROJECT)).map((r) => r.status)).toEqual(['failed', 'ok']);
  });

  it('keeps an AI-overwritten singleton body on the edited event', async () => {
    const { repo } = setup();
    const briefRun = (problem: string) => output({
      run: runInput({ task: 'BRIEF_EXTRACT', node: 'brief' }), drafts: [{ type: 'brief', body: briefBody(problem) }],
    });
    const { created: [brief] } = await repo.saveRunOutput(PROJECT, briefRun('v1'));
    await repo.updateItem(PROJECT, brief.id, { decision: 'accepted' }, { actor: 'human' });
    await repo.saveRunOutput(PROJECT, briefRun('v2'));
    const events = await repo.listEvents(PROJECT, { itemId: brief.id });
    const edited = events.find((e) => e.kind === 'edited');
    expect(edited?.prevBody).toEqual(brief.body);
  });

  it('acceptRecommended accepts recommended pending items in one write', async () => {
    const { storage, repo } = setup();
    await repo.saveRunOutput(PROJECT, usersRun([
      { ref: 'p1', type: 'persona', body: rawPersona('p1'), aiStance: { verdict: 'recommend', reason: 'r' } },
      { ref: 'p2', type: 'persona', body: rawPersona('p2'), aiStance: { verdict: 'caution', reason: 'c' } },
    ]));
    const spy = vi.spyOn(storage, 'setItem');
    const accepted = await repo.acceptRecommended(PROJECT, 'users');
    expect(accepted.map((i) => i.decision)).toEqual(['accepted']);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await repo.listEvents(PROJECT)).at(-1)).toMatchObject({ kind: 'accepted', actor: 'human' });
    expect(await repo.acceptRecommended(PROJECT, 'users')).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('localProjectId decodes the slug so encoded and decoded URLs share one key', () => {
    expect(localProjectId('%E9%A1%B9%E7%9B%AE-a1')).toBe('项目-a1');
    expect(localProjectId('项目-a1')).toBe('项目-a1');
    expect(localProjectId('bad%E4')).toBe('bad%E4');
  });

  it('updateItem bumps the version on body edits and appends events', async () => {
    const { repo } = setup();
    const { created } = await repo.saveRunOutput(PROJECT, usersRun());
    const persona = created[0];
    const edited = await repo.updateItem(PROJECT, persona.id, { body: personaBody('Edited') }, { actor: 'human' });
    expect(edited).toMatchObject({ version: 2, origin: 'ai_edited', decision: 'pending' });
    const graph = await repo.getGraph(PROJECT);
    expect(graph.items.find((i) => i.id === persona.id)?.version).toBe(2);
    const events = await repo.listEvents(PROJECT, { itemId: persona.id });
    expect(events.map((e) => [e.kind, e.fromVersion, e.toVersion])).toEqual([['created', 0, 1], ['edited', 1, 2]]);
  });

  it('a no-op update does not write', async () => {
    const { storage, repo } = setup();
    const { created } = await repo.saveRunOutput(PROJECT, usersRun());
    const spy = vi.spyOn(storage, 'setItem');
    await repo.updateItem(PROJECT, created[0].id, { body: personaBody() }, { actor: 'human' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('soft-deletes: hidden from graph and default listing, kept with includeDeleted', async () => {
    const { repo } = setup();
    const { created } = await repo.saveRunOutput(PROJECT, usersRun());
    await repo.updateItem(PROJECT, created[0].id, { deleted: true }, { actor: 'human' });
    const graph = await repo.getGraph(PROJECT);
    expect(graph.items.map((i) => i.id)).toEqual([created[1].id]);
    expect(graph.links).toEqual([]);
    expect(await repo.listItems(PROJECT, { includeDeleted: true })).toHaveLength(2);
    expect(await repo.listItems(PROJECT, { type: 'job', decision: 'pending' })).toHaveLength(1);
  });

  it('createItem stores human items with links; refreshLinks clears staleness', async () => {
    const { repo } = setup();
    const { created } = await repo.saveRunOutput(PROJECT, usersRun());
    const job = await repo.createItem(PROJECT, {
      node: 'users', type: 'job', body: jobBody('Mine'), links: [{ to: created[0].id, rel: 'derived_from' }],
    });
    expect(job).toMatchObject({ origin: 'human', decision: 'accepted' });
    await repo.updateItem(PROJECT, created[0].id, { body: personaBody('v2') }, { actor: 'human' });
    const link = (await repo.getGraph(PROJECT)).links.find((l) => l.from === job.id);
    expect(link?.toVersionSeen).toBe(1);
    const [refreshed] = await repo.refreshLinks(PROJECT, [link?.id ?? '']);
    expect(refreshed.toVersionSeen).toBe(2);
    expect((await repo.getGraph(PROJECT)).links.find((l) => l.id === link?.id)?.toVersionSeen).toBe(2);
  });

  it('lists runs newest first and filters them', async () => {
    const { repo } = setup();
    const a = await repo.saveRunOutput(PROJECT, usersRun());
    const b = await repo.saveRunOutput(PROJECT, output({ run: runInput({ task: 'STAKE_MATRIX', node: 'stake' }) }));
    expect((await repo.listRuns(PROJECT)).map((r) => r.id)).toEqual([b.run.id, a.run.id]);
    expect((await repo.listRuns(PROJECT, { node: 'stake' })).map((r) => r.id)).toEqual([b.run.id]);
  });

  it('throws not_found for unknown items', async () => {
    const { repo } = setup();
    await expect(repo.updateItem(PROJECT, 'per_x', { decision: 'accepted' }, { actor: 'human' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('throws a storage error when no storage is available', async () => {
    const repo = new LocalRepository({ storage: undefined });
    if (typeof globalThis.localStorage === 'undefined') {
      await expect(repo.listItems(PROJECT)).rejects.toMatchObject({ code: 'storage' });
    }
  });
});

describe('LocalRepository · corrupt storage', () => {
  it('treats unparseable JSON as an empty project, backs it up and reports it', async () => {
    const onCorrupt = vi.fn();
    const { storage, repo } = setup({ onCorrupt });
    storage.data.set(localProjectKey(PROJECT), '{not json');
    expect(await repo.listItems(PROJECT)).toEqual([]);
    expect(storage.data.get(localBackupKey(PROJECT))).toBe('{not json');
    expect(onCorrupt).toHaveBeenCalledWith(expect.objectContaining({ report: expect.objectContaining({ reset: true }) }));
    await repo.saveRunOutput(PROJECT, usersRun());
    expect(await repo.listItems(PROJECT)).toHaveLength(2);
  });

  it('drops invalid records and dangling links, keeps the rest', async () => {
    const onCorrupt = vi.fn();
    const { storage, repo } = setup({ onCorrupt });
    await repo.saveRunOutput(PROJECT, usersRun());
    const doc = JSON.parse(storage.data.get(localProjectKey(PROJECT)) ?? '{}');
    doc.items[0].body = { name: 42 };             // persona body no longer valid → link to it dangles
    doc.items.push({ ...doc.items[1] });          // duplicate id
    doc.items.push({ ...doc.items[1], id: 'x', projectId: 'someone-else' });
    doc.runs.push({ nope: true });
    storage.data.set(localProjectKey(PROJECT), JSON.stringify(doc));

    const graph = await repo.getGraph(PROJECT);
    expect(graph.items.map((i) => i.type)).toEqual(['job']);
    expect(graph.links).toEqual([]);
    expect(onCorrupt.mock.calls[0][0].report).toMatchObject({ reset: false, droppedItems: 3, droppedLinks: 1, droppedRuns: 1 });
  });

  it('refuses to read (and so to overwrite) a newer storage format', async () => {
    const { storage, repo } = setup();
    storage.data.set(localProjectKey(PROJECT), JSON.stringify({ v: LOCAL_DOC_VERSION + 1, items: [] }));
    await expect(repo.saveRunOutput(PROJECT, usersRun())).rejects.toMatchObject({ code: 'storage' });
    expect(JSON.parse(storage.data.get(localProjectKey(PROJECT)) ?? '{}').v).toBe(LOCAL_DOC_VERSION + 1);
  });
});
