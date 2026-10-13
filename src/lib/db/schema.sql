-- Thinking Desk · core schema
-- Data model: docs/data-model.md. Item bodies are JSONB validated in the app
-- (src/lib/model/item-types.ts), so new item types need no migration.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  summary     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_id, slug)
);

-- Phase 1 replaced the per-node JSON blobs and the exchange log with
-- items / links / runs / decision_events. No data was migrated (none existed).
DROP TABLE IF EXISTS comments;
DROP TABLE IF EXISTS assumptions;
DROP TABLE IF EXISTS ai_exchanges;
DROP TABLE IF EXISTS nodes;

-- One row per AI call (replaces ai_exchanges). Append-only.
CREATE TABLE IF NOT EXISTS runs (
  project_id     UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id             TEXT NOT NULL,
  seq            BIGINT GENERATED ALWAYS AS IDENTITY,
  task           TEXT NOT NULL,
  node           TEXT NOT NULL,
  provider       TEXT NOT NULL,
  model          TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  inputs         JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{ itemId, version }]
  status         TEXT NOT NULL CHECK (status IN ('ok','retried','failed')),
  error          TEXT,
  usage          JSONB,                                -- { inputTokens, outputTokens }
  latency_ms     INTEGER NOT NULL CHECK (latency_ms >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS runs_project_created_idx ON runs (project_id, created_at DESC);

-- Every unit of content, AI- or human-authored, with the human's judgment.
-- Ids are '<type prefix>_<random>' and unique per project; rows are never
-- hard-deleted (deleted_at = soft delete) so decision_events stay valid.
CREATE TABLE IF NOT EXISTS items (
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id            TEXT NOT NULL,
  seq           BIGINT GENERATED ALWAYS AS IDENTITY,   -- stable output order
  node          TEXT NOT NULL,
  type          TEXT NOT NULL,
  body          JSONB NOT NULL,
  origin        TEXT NOT NULL CHECK (origin IN ('ai','human','ai_edited')),
  decision      TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected')),
  decision_note TEXT,
  ai_stance     JSONB,                                 -- { verdict, reason }
  evidence      JSONB,                                 -- { basis, confidence, sources[] }
  version       INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  run_id        TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, run_id) REFERENCES runs (project_id, id)
);
CREATE INDEX IF NOT EXISTS items_project_node_type_idx
  ON items (project_id, node, type) WHERE deleted_at IS NULL;
-- At most one live item per (project, node, type) for cardinality 'one' types.
-- Keep the list in sync with ITEM_TYPE_DEFS (a unit test checks it).
CREATE UNIQUE INDEX IF NOT EXISTS items_singleton_idx
  ON items (project_id, node, type)
  WHERE deleted_at IS NULL AND type IN ('brief','engagement_plan','diff_hypothesis');

-- "from depends on to". Staleness is computed: to.version > to_version_seen.
CREATE TABLE IF NOT EXISTS links (
  project_id      UUID NOT NULL,
  id              TEXT NOT NULL,
  from_id         TEXT NOT NULL,
  to_id           TEXT NOT NULL,
  rel             TEXT NOT NULL CHECK (rel IN (
                    'derived_from','serves','addresses','implements',
                    'mitigates','conflicts_with','assumes','depends_on')),
  to_version_seen INTEGER NOT NULL CHECK (to_version_seen >= 1),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  UNIQUE (project_id, from_id, to_id, rel),
  FOREIGN KEY (project_id, from_id) REFERENCES items (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, to_id)   REFERENCES items (project_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS links_to_idx ON links (project_id, to_id);

-- Append-only audit trail of every item change.
CREATE TABLE IF NOT EXISTS decision_events (
  project_id   UUID NOT NULL,
  id           TEXT NOT NULL,
  seq          BIGINT GENERATED ALWAYS AS IDENTITY,
  item_id      TEXT NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('created','accepted','rejected','reset','edited','deleted','link_added','link_removed','link_confirmed','evidence_updated')),
  from_version INTEGER NOT NULL CHECK (from_version >= 0),
  to_version   INTEGER NOT NULL CHECK (to_version >= 1),
  note         TEXT,
  prev_body    JSONB,                                -- body before an edit (size-capped; always kept for AI singleton rewrites)
  link         JSONB,                                -- link_* events: { id, to, rel }
  actor        TEXT NOT NULL CHECK (actor IN ('human','ai')),
  at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, item_id) REFERENCES items (project_id, id) ON DELETE CASCADE
);
-- Databases initialised before prev_body / link and the link_* / evidence_updated kinds existed.
-- (Postgres names the column CHECK above decision_events_kind_check.)
ALTER TABLE decision_events ADD COLUMN IF NOT EXISTS prev_body JSONB;
ALTER TABLE decision_events ADD COLUMN IF NOT EXISTS link JSONB;
ALTER TABLE decision_events DROP CONSTRAINT IF EXISTS decision_events_kind_check;
ALTER TABLE decision_events ADD CONSTRAINT decision_events_kind_check
  CHECK (kind IN ('created','accepted','rejected','reset','edited','deleted','link_added','link_removed','link_confirmed','evidence_updated'));
CREATE INDEX IF NOT EXISTS decision_events_item_idx ON decision_events (project_id, item_id, seq);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_touch ON projects;
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Seed a demo user + project so the app is usable right after init.
INSERT INTO users (id, email, name)
  VALUES ('00000000-0000-0000-0000-000000000001', 'demo@thinking-desk.local', '演示用户')
  ON CONFLICT (email) DO NOTHING;

INSERT INTO projects (id, owner_id, name, slug, summary)
  VALUES (
    '00000000-0000-0000-0000-00000000a001',
    '00000000-0000-0000-0000-000000000001',
    'K12 · AI 学习陪练',
    'demo',
    '给初中生做的 AI 学习陪练 · 文档示例项目'
  )
  ON CONFLICT (owner_id, slug) DO NOTHING;
