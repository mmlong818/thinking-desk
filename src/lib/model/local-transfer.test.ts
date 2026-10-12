import { describe, expect, it } from 'vitest';
import { LocalRepository, localProjectKey } from './local-repository';
import { forkLocalProject, importLocalProject, removeLocalProjectData } from './local-transfer';
import { output, rawJob, rawPersona, seqIdSource, T1 } from './__fixtures__/model';
import { memoryStorage } from './__fixtures__/storage';

async function seeded() {
  const storage = memoryStorage();
  const repo = new LocalRepository({ storage, now: () => T1, idSource: seqIdSource() });
  await repo.saveRunOutput('src', output({
    drafts: [
      { ref: 'p1', type: 'persona', body: rawPersona('p1') },
      { ref: 'j1', type: 'job', body: rawJob('j1', ['p1']) },
    ],
  }));
  const [persona] = (await repo.getGraph('src')).items;
  await repo.updateItem('src', persona.id, { decision: 'accepted' }, { actor: 'human' });
  return { storage, repo };
}

describe('forkLocalProject', () => {
  it('copies items, links, runs and events under the new projectId, leaving the source intact', async () => {
    const { storage, repo } = await seeded();
    expect(forkLocalProject(storage, 'src', 'dst')).toBe(true);
    const [src, dst] = [await repo.getGraph('src'), await repo.getGraph('dst')];
    expect(dst.items.map((i) => [i.id, i.decision])).toEqual(src.items.map((i) => [i.id, i.decision]));
    expect(dst.items.every((i) => i.projectId === 'dst')).toBe(true);
    expect(dst.links).toHaveLength(1);
    expect(await repo.listRuns('dst')).toHaveLength(1);
    expect((await repo.listEvents('dst')).length).toBe((await repo.listEvents('src')).length);
  });

  it('does nothing for a project without data and refuses to overwrite', async () => {
    const { storage } = await seeded();
    expect(forkLocalProject(storage, 'empty', 'x')).toBe(false);
    forkLocalProject(storage, 'src', 'dst');
    expect(() => forkLocalProject(storage, 'src', 'dst')).toThrow(/already has local data/);
  });
});

describe('importLocalProject', () => {
  it('imports an exported graph under a new id and drops invalid records', async () => {
    const { storage, repo } = await seeded();
    const graph = await repo.getGraph('src');
    const report = importLocalProject(storage, 'imp', { items: [...graph.items, { id: 'bad' }], links: graph.links });
    expect(report.droppedItems).toBe(1);
    expect((await repo.getGraph('imp')).items).toHaveLength(2);
    removeLocalProjectData({ ...storage, removeItem: (k: string) => storage.data.delete(k) }, 'imp');
    expect(storage.data.has(localProjectKey('imp'))).toBe(false);
  });
});
