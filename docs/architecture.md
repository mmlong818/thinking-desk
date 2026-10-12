# Architecture

## Overview

Thinking Desk is a Next.js 15 App Router application. The front-end and back-end share one process. AI calls are made server-side via route handlers (never directly from the browser).

```
Browser
  │
  ├─ GET /project/[id]/[node]
  │    └─ SSR (page.tsx) loads the project + node rows from Postgres when available,
  │       merges in the completion cookie, then renders the node or the lock screen
  │
  └─ POST /api/ai/<task>
       └─ aiRoute() (src/lib/ai/route.ts) validates the body and upstream snapshots (Zod)
            └─ task function builds the prompt (request data inside <data> blocks)
                 └─ runTask() (src/lib/ai/run-task.ts)
                      ├─ router.ts resolves provider:model from env / override
                      ├─ provider adapter calls the vendor API once (complete())
                      └─ Zod-validates the answer (one retry with the errors fed back), deadline + abort
                           └─ route returns one JSON response: { ok, data, run }
```

There is no streaming: every provider exposes a single `complete()` that returns the full response, and route handlers reply with plain JSON. `run` is the run metadata (provider, model, promptVersion, usage, latency, status) shaped for the `Run` record of the data model; routes do not persist it yet.

`src/middleware.ts` sits in front of `/api/*`: optional bearer-token auth (`REQUIRE_AUTH`) and a per-IP in-memory rate limit on `/api/ai/*`.

## Persistence Layers

Two independent persistence strategies; the app uses whichever is available.

### Postgres (optional)

- Tables: `users`, `projects` and the Phase 1 data model `items`, `links`, `runs`, `decision_events`, accessed through `PgRepository` (`src/lib/db/pg-repository.ts`; see [data-model.md](data-model.md)). Node pages are not migrated yet: their legacy `nodes` reader now fails softly, and AI routes no longer touch the database (they work from the snapshots in the request body), so until then DB mode behaves like pure-local mode for node content.
- `src/lib/db/client.ts` — a lazily created singleton `pg.Pool` (created on the first query, 3 s connection timeout) plus `withTransaction()`. Importing the module never throws.
- `query()` **throws** when `DATABASE_URL` is unset or the database is unreachable; the functions in `src/lib/db/projects.ts` propagate that error. Callers (route handlers, SSR pages) wrap DB calls in try/catch and fall through to the local layer, for example `listProjects()` failures return an empty list plus `db_error`.
- Schema is auto-applied on `docker compose up` via the init script mount.

### Pure-local (no DB)

- **sessionStorage** — node output JSON, keyed `td:<projectSlug>:<nodeKind>`.
- **Cookie** `td-done:<slug>` — comma-separated completed `NodeKind`s (long slugs use the hashed name `td-done-h:<hash>`; `cookieNameCandidates(slug)` lists the possible names).
  - Written by `writeCache()` in `src/lib/client-cache.ts`.
  - Read by the SSR page to decide whether to show the lock screen.
  - Content is kind names only (no payload) — stays under 4 KB per project.
- Limitation: tab-scoped. Multiple tabs for the same project will not share state in pure-local mode.

## AI Layer

```
AiTask (string literal union in types.ts)
  │
  └─ router.ts
       reads AI_MODEL_<TASK> → AI_MODEL_DEFAULT → first configured provider
       returns { provider, model }
  │
  └─ providers/<name>.ts   (claude.ts, openai.ts, gemini.ts, zhipu.ts)
       implements AiProvider: name, isConfigured(), listModels(), complete(model, req)
```

`complete()` resolves to `{ text, provider, model, latencyMs, usage, finishReason }`. Providers never parse: `runTask()` parses the text (`json.ts`), validates it against the task's Zod schema and retries once with the validation errors. The JSON Schema it sends comes from the same Zod schema (`json-schema.ts`); each provider uses its native structured output when the schema fits (Claude `output_config.format` on supporting models, Gemini `responseJsonSchema`), otherwise it embeds the schema in the prompt.

Adding a provider: implement the `AiProvider` interface and register it in the `PROVIDERS` map in `router.ts`.

## Request Flow (node page)

1. User navigates to `/project/my-app/brief`.
2. SSR loads completed nodes from Postgres (if reachable) and from the `td-done:my-app` cookie → determines which nodes are complete.
3. If upstream deps are met, renders `BriefNode`. Otherwise renders `LockedNode`.
4. User interacts; the node component POSTs to `/api/ai/extract-brief` (and the other brief routes `clarify-brief`, `probe-brief`).
5. The JSON response updates the UI; on save, `writeCache()` writes to sessionStorage and updates the cookie. (Persisting runs and items through the repositories arrives with the node migration.)

## Component Hierarchy

```
app/project/[id]/[node]/page.tsx
  └─ shell/TopBar              ← includes ExportButton (Markdown / JSON export)
  └─ shell/NavRail
  └─ <NodeComponent>          ← one of: BriefNode, UsersNode, …, SplitNode
       └─ shell/Copilot       ← AI Q&A panel (right side)
            └─ shell/ModelPicker
```
