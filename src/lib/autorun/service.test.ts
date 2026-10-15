import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
vi.mock('../db/client', () => ({ query: (...args: unknown[]) => query(...args) }));

const row = (status: string) => ({
  id: 'run-1', project_id: 'p1', slug: 's', status, current_step: 'scen_combine', steps: [], model: null,
  error: null, project_url: 'http://x/project/s/final', result: null,
  created_at: new Date('2026-10-15T00:00:00Z'), updated_at: new Date('2026-10-15T00:00:00Z'),
});

beforeEach(() => {
  vi.resetModules();
  globalThis.__autorun = undefined;
  query.mockReset();
});

describe('getAutorun', () => {
  it('reports a run this process is not running as failed instead of running forever', async () => {
    query.mockImplementation(async (sql: string) => (sql.startsWith('SELECT') ? [row('running')] : []));
    const { getAutorun } = await import('./service');
    const got = await getAutorun('run-1');
    expect(got).toMatchObject({ status: 'failed', currentStep: null, error: 'server_restarted' });
    expect(query.mock.calls.some(([sql]) => String(sql).startsWith('UPDATE autoruns'))).toBe(true);
  });

  it('says why when the failure itself could not be recorded', async () => {
    query.mockImplementation(async (sql: string) => (sql.startsWith('SELECT') ? [row('running')] : []));
    globalThis.__autorun = { running: new Map(), queue: [], lost: new Map([['run-1', 'scen_combine: Connection terminated']]) };
    const { getAutorun } = await import('./service');
    expect(await getAutorun('run-1')).toMatchObject({ status: 'failed', error: 'scen_combine: Connection terminated' });
  });

  it('leaves an ended run as it is', async () => {
    query.mockImplementation(async () => [row('done')]);
    const { getAutorun } = await import('./service');
    expect(await getAutorun('run-1')).toMatchObject({ status: 'done' });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
