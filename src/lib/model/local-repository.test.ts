import { describe, expect, it, vi } from 'vitest';
import { LOCAL_DOC_VERSION } from './local-doc';
import { LocalRepository, localBackupKey, localProjectKey, type LocalRepositoryOptions } from './local-repository';
import { RepositoryError } from './repository';
import {
  jobBody, output, personaBody, PROJECT, rawJob, rawPersona, runInput, seqIdSource, T0,
} from './__fixtures__/model';
import { memoryStorage } from './__fixtures__/storage';

function setup(opts: Partial<LocalRepositoryOptions> = {}) {
  const storage = memoryStorage();
  const repo = new LocalRepository({ storage, now: () => T0, idSource: seqIdSource(), ...opts });
  return { storage, repo };
}

const usersRun = (drafts = [
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
    const first = await repo.saveRunOutput(PROJECT, usersRun());
    const [persona, job] = first.created;
    await repo.updateItem(PROJECT, persona.id, { decision: 'accepted' }, { actor: 'human' });
    const second = await repo.saveRunOutput(PROJECT, usersRun([
      { ref: 'p9', type: 'persona', body: rawPersona('p9', 'New') },
    ]));
    expect(second.retired).toEqual([job.id]);
    const live = await repo.listItems(PROJECT);
    expect(live.map((i) => i.id)).toEqual([persona.id, second.created[0].id]);
    expect((await repo.getGraph(PROJECT)).links).toEqual([]);
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
