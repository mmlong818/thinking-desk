import { describe, expect, it, vi } from 'vitest';
import { itemToJson, mapRows, rowToEvent, rowToItem, rowToLink, rowToRun, type ItemRow } from './pg-rows';
import { personaBody } from '../model/__fixtures__/model';

const PID = '00000000-0000-0000-0000-00000000a001';

const itemRow = (over: Partial<ItemRow> = {}): ItemRow => ({
  project_id: PID, id: 'per_1', node: 'users', type: 'persona', body: personaBody(),
  origin: 'ai', decision: 'pending', decision_note: null, ai_stance: null, evidence: null,
  version: 1, run_id: 'run_1', created_at: new Date('2026-10-13T00:00:00Z'),
  updated_at: new Date('2026-10-13T01:00:00Z'), deleted_at: null, ...over,
});

describe('rowToItem', () => {
  it('maps snake_case columns, Dates and NULLs to the model shape', () => {
    const item = rowToItem(itemRow());
    expect(item).toEqual({
      id: 'per_1', projectId: PID, node: 'users', type: 'persona', body: personaBody(), origin: 'ai',
      decision: 'pending', version: 1, runId: 'run_1',
      createdAt: '2026-10-13T00:00:00.000Z', updatedAt: '2026-10-13T01:00:00.000Z',
    });
    expect(item).not.toHaveProperty('decisionNote');
  });

  it('keeps optional JSONB columns and soft-delete timestamps', () => {
    const item = rowToItem(itemRow({
      decision: 'rejected', decision_note: 'n', ai_stance: { verdict: 'caution', reason: 'r' },
      deleted_at: '2026-10-13T02:00:00Z',
    }));
    expect(item).toMatchObject({ decisionNote: 'n', aiStance: { verdict: 'caution' }, deletedAt: '2026-10-13T02:00:00.000Z' });
  });

  it('returns null for rows that fail envelope or body validation', () => {
    expect(rowToItem(itemRow({ origin: 'robot' }))).toBeNull();
    expect(rowToItem(itemRow({ body: { name: 1 } }))).toBeNull();
  });
});

describe('itemToJson', () => {
  it('omits absent optionals so the bulk statements write SQL NULL', () => {
    const item = rowToItem(itemRow());
    expect(item && itemToJson(item)).toEqual({
      id: 'per_1', node: 'users', type: 'persona', body: personaBody(), origin: 'ai', decision: 'pending',
      version: 1, run_id: 'run_1', created_at: '2026-10-13T00:00:00.000Z', updated_at: '2026-10-13T01:00:00.000Z',
    });
  });
});

describe('rowToLink / rowToRun / rowToEvent', () => {
  it('map their rows', () => {
    expect(rowToLink({ project_id: PID, id: 'l', from_id: 'a', to_id: 'b', rel: 'serves', to_version_seen: 2 }))
      .toEqual({ id: 'l', projectId: PID, from: 'a', to: 'b', rel: 'serves', toVersionSeen: 2 });
    expect(rowToRun({
      project_id: PID, id: 'run_1', task: 'USERS_JTBD', node: 'users', provider: 'claude', model: 'm',
      prompt_version: 'h', inputs: [{ itemId: 'brf_1', version: 2 }], status: 'ok', error: null, usage: null,
      latency_ms: 10, created_at: new Date('2026-10-13T00:00:00Z'),
    })).toMatchObject({ promptVersion: 'h', latencyMs: 10, inputs: [{ itemId: 'brf_1', version: 2 }] });
    expect(rowToEvent({
      project_id: PID, id: 'evt_1', item_id: 'per_1', kind: 'accepted', from_version: 1, to_version: 1,
      note: null, prev_body: null, actor: 'human', at: new Date('2026-10-13T00:00:00Z'),
    })).toEqual({
      id: 'evt_1', projectId: PID, itemId: 'per_1', kind: 'accepted', fromVersion: 1, toVersion: 1,
      actor: 'human', at: '2026-10-13T00:00:00.000Z',
    });
  });

  it('maps prev_body (JSONB) to prevBody on edited events', () => {
    const prev = { raw_text: 'old' };
    expect(rowToEvent({
      project_id: PID, id: 'evt_2', item_id: 'brf_1', kind: 'edited', from_version: 1, to_version: 2,
      note: 'run run_1', prev_body: prev, actor: 'ai', at: new Date('2026-10-13T00:00:00Z'),
    })).toMatchObject({ kind: 'edited', prevBody: prev });
  });
});

describe('mapRows', () => {
  it('skips invalid rows and reports how many', () => {
    const onInvalid = vi.fn();
    expect(mapRows([itemRow(), itemRow({ origin: 'x' })], rowToItem, onInvalid)).toHaveLength(1);
    expect(onInvalid).toHaveBeenCalledWith(1);
  });
});
