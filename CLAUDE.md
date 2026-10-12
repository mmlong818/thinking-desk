# Thinking Desk — Agent Context

**Version:** 0.1.0 | **Port:** 3000 | **Stack:** Next.js 15 + React 19 + TypeScript + Tailwind + Postgres (optional)

## What

Alpha product-thinking tool. 9 sequential nodes walk a user through problem clarification → design → task breakdown. AI co-pilot (right panel) asks one question at a time. UI is in Chinese; code and identifiers are English.

## Quick Start

```bash
./setup.sh              # install deps, create .env
pnpm dev                # http://localhost:3000
pnpm typecheck          # tsc --noEmit
pnpm lint               # next lint (ESLint 9 flat config, eslint.config.mjs)
pnpm test               # vitest run (unit tests live next to the code as *.test.ts)
pnpm build              # next build — must pass without DATABASE_URL / API keys
docker compose up -d db # optional Postgres (auto-runs schema.sql)
```

## Key Directories

```
src/
├── app/
│   ├── api/ai/              # AI route handlers (one dir per task, JSON responses)
│   ├── api/projects|providers/  # project list/create · configured providers + models
│   └── project/[id]/[node]/ # SSR node pages; reads cookie for lock state
├── components/
│   ├── nodes/               # BriefNode, UsersNode, … SplitNode (one per kind)
│   └── shell/               # TopBar, NavRail, Copilot, ModelPicker, ExportButton
├── data/nodes.ts            # Source of truth: NODES array, deps, completion rules, formatNodeNum()
└── lib/
    ├── ai/
    │   ├── router.ts        # env-var task→provider:model resolution
    │   ├── providers/       # claude.ts, openai.ts, gemini.ts, zhipu.ts (complete() returns one full response)
    │   ├── schemas/         # client-safe Zod output schemas, types, UI constants (no router/provider imports)
    │   ├── tasks/           # server-only prompt builders that call the AI (import their schema from schemas/)
    │   └── types.ts         # AiTask union — add new tasks here first
    ├── model/               # Item/Link/Run/DecisionEvent, item-type registry, pure planners, LocalRepository (docs/data-model.md)
    ├── client-cache.ts      # sessionStorage R/W + cookie completion flags
    ├── client-model.ts      # client-side model picker helpers
    └── db/                  # lazy Postgres pool, withTransaction, PgRepository, schema.sql (optional; query() throws, callers catch)
```

Phase 1 data model: `src/lib/model/` + `src/lib/db/pg-repository.ts` are in place but not yet wired into node pages / AI routes, which still use the sessionStorage payloads below. See `docs/data-model.md`.

## Pure-Local Mode (no Postgres)

When `DATABASE_URL` is absent or the DB is unreachable the app falls back to:

1. **sessionStorage** keyed `td:<projectSlug>:<nodeKind>` — stores node output JSON.
2. **Cookie** `td-done:<slug>` — comma-separated list of completed `NodeKind`s.
   - Written client-side by `writeCache()` in `client-cache.ts`.
   - Read server-side by `app/project/[id]/[node]/page.tsx` to skip the lock screen.
   - Contains only kind names (no content) — stays well under 4 KB. Long slugs use the hashed name `td-done-h:<hash>`; use `cookieNameCandidates(slug)` to find it.

Gotcha: `sessionStorage` is tab-scoped. Opening a second tab for the same project in pure-local mode will not show the other tab's data.

## Node Dependency Graph

Defined in `src/data/nodes.ts`. The `deps` field on each `NodeDef` is the source of truth — changing it here automatically propagates to the lock screen logic.

```
brief → users, stake, alt, scen, feat
feat  → leap, final
final → split
```

`isNodeLocked(kind, completedSet)` and `missingDeps()` are exported utilities — use them, do not reimplement.

## Adding a Node

1. Add `NodeKind` literal to `src/data/nodes.ts` union.
2. Push a `NodeDef` to `NODES` with correct `deps` and `completion` rules (item types that must be accepted; register new item types in `src/lib/model/item-types.ts`).
3. Create `src/components/nodes/YourNode.tsx` — copy `BriefNode.tsx` as template.
4. Map the new kind in `src/app/project/[id]/[node]/page.tsx`.

## Adding an AI Task

1. Add literal to `AiTask` in `src/lib/ai/types.ts`.
2. Create `src/lib/ai/schemas/your-task.ts` (Zod output schema + types, client-safe) and `src/lib/ai/tasks/your-task.ts` (prompt builder). Components import from `schemas/` only — `schemas/client-safety.test.ts` fails if client code reaches the router or a provider SDK.
3. Create `src/app/api/ai/your-task/route.ts` — POST handler that calls the task and returns JSON (no streaming; providers expose a single `complete()`).
4. Document `AI_MODEL_YOUR_TASK` in `.env.example`.

## AI Model Routing

`src/lib/ai/router.ts` reads `process.env.AI_MODEL_<TASK>`. Format:

- `claude` — auto-pick a model from the Anthropic provider
- `claude:claude-sonnet-4-6` — pin a specific model ID
- Falls back to `AI_MODEL_DEFAULT`, then first configured provider.

## Common Gotchas

- **`formatNodeNum(kind)`** in `data/nodes.ts` generates the `NODE · 08 / 09` header. Do not hardcode node numbers in components.
- **`forkCache(fromSlug, toSlug)`** copies all sessionStorage entries when branching a project — call this before navigating to the new slug.
- **Turbopack** (`pnpm dev --turbopack`) is the default dev server. If you hit a Turbopack-specific build error, try `pnpm dev` without `--turbopack` to isolate.
- **`src/lib/db/`** — `query()` throws when `DATABASE_URL` is unset or the DB is unreachable (the pool is created lazily on first query, 3 s connect timeout). Every caller must wrap DB calls in try/catch and degrade, so pure-local mode works.
- **No `any`** — TypeScript strict mode. Use `unknown` + type guards or Zod parsing.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | Postgres connection string; omit for pure-local mode |
| `ANTHROPIC_API_KEY` | At least one | Claude provider |
| `OPENAI_API_KEY` | At least one | OpenAI provider |
| `GEMINI_API_KEY` | At least one | Google Gemini provider |
| `ZHIPU_API_KEY` | At least one | Zhipu GLM provider |
| `AI_MODEL_DEFAULT` | No | Fallback routing (`provider` or `provider:model`) |
| `AI_MODEL_<TASK>` | No | Per-task override; task names from `AiTask` union |
| `REQUIRE_AUTH` / `REQUIRE_AUTH_TOKEN` | No | `middleware.ts`: require `Authorization: Bearer <token>` on `/api/*` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | No | `middleware.ts`: per-IP in-memory limit on `/api/ai/*` (default 20 / 60 s) |
| `*_BASE_URL`, `ALLOW_CUSTOM_AI_BASE_URL` | No | Provider endpoints; non-vendor hosts are rejected unless `ALLOW_CUSTOM_AI_BASE_URL=true` |
