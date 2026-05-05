-- Thinking Desk · core schema
-- Every table uses surrogate UUID. Node content is stored as JSONB so the
-- shape can evolve without migrations during early iterations.

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

-- Node types match the 9-node methodology. Stored as text so new node types
-- can be added without enum migrations.
CREATE TABLE IF NOT EXISTS nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  content     JSONB NOT NULL DEFAULT '{}'::jsonb,
  completeness SMALLINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, kind)
);

-- Every AI exchange is persisted so export documents can embed the probe/
-- answer trail (doc §6.4).
CREATE TABLE IF NOT EXISTS ai_exchanges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_kind     TEXT NOT NULL,
  task          TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('feed','ask','check','critique')),
  prompt        TEXT NOT NULL,
  response      JSONB NOT NULL,
  user_reply    JSONB,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  latency_ms    INTEGER,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_exchanges_project_node_idx
  ON ai_exchanges (project_id, node_kind, created_at DESC);

-- Assumption ledger (doc §8)
CREATE TABLE IF NOT EXISTS assumptions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  body          TEXT NOT NULL,
  signal        TEXT NOT NULL,
  threshold     TEXT NOT NULL,
  source_node   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','validated','refuted','evolved')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  node_kind   TEXT,
  author_id   UUID NOT NULL REFERENCES users(id),
  body        TEXT NOT NULL,
  anchor      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS projects_touch ON projects;
CREATE TRIGGER projects_touch BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS nodes_touch ON nodes;
CREATE TRIGGER nodes_touch BEFORE UPDATE ON nodes
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
