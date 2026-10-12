import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ITEM_TYPE_DEFS } from '../model/item-types';
import { ACTORS, DECISIONS, EVENT_KINDS, ITEM_TYPES, LINK_RELS, ORIGINS, RUN_STATUSES } from '../model/types';

// schema.sql duplicates a few enums as CHECK constraints; keep them in sync with the model.
const sql = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

function checkList(column: string): string[] {
  const m = sql.match(new RegExp(`CHECK \\(${column} IN \\(([^)]*)\\)\\)`));
  if (!m) throw new Error(`no CHECK list for ${column}`);
  return m[1].split(',').map((s) => s.trim().replace(/'/g, ''));
}

describe('schema.sql', () => {
  it.each([
    ['origin', ORIGINS],
    ['decision', DECISIONS],
    ['rel', LINK_RELS],
    ['status', RUN_STATUSES],
    ['kind', EVENT_KINDS],
    ['actor', ACTORS],
  ])('CHECK (%s IN …) matches the model', (column, values) => {
    expect(checkList(column)).toEqual([...values]);
  });

  it('guards exactly the singleton item types with the partial unique index', () => {
    const m = sql.match(/items_singleton_idx[\s\S]*?type IN \(([^)]*)\)/);
    const indexed = (m?.[1] ?? '').split(',').map((s) => s.trim().replace(/'/g, ''));
    const singletons = ITEM_TYPES.filter((t) => ITEM_TYPE_DEFS[t].cardinality === 'one');
    expect(indexed.sort()).toEqual([...singletons].sort());
  });

  it('drops the pre-Phase-1 tables and no longer creates them', () => {
    for (const t of ['nodes', 'ai_exchanges', 'assumptions', 'comments']) {
      expect(sql).toContain(`DROP TABLE IF EXISTS ${t};`);
      expect(sql).not.toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${t}\\b`));
    }
  });
});
