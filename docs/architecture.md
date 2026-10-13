# Architecture

## Overview

Thinking Desk is a Next.js 15 App Router application. The front-end and back-end share one process. AI calls are made server-side via route handlers (never directly from the browser).

```
Browser
  │
  ├─ GET /project/[id]/[node]
  │    └─ SSR (page.tsx) looks the project up in Postgres: found → Postgres mode (graph loaded,
  │       completion derived from items); otherwise pure-local mode (completion from the td-done
  │       cookie). Renders the node or the lock screen inside a ProjectStoreProvider
  │
  ├─ GET|POST|PATCH /api/projects/[id]/{graph,runs,items,items/[itemId],accept-recommended,fork}
  ├─ DELETE /api/projects/[id]  (whole project, one transaction)
  │    └─ Postgres mode only: PgRepository behind Zod-validated handlers (src/lib/api/project-api.ts)
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

There is no streaming: every provider exposes a single `complete()` that returns the full response, and route handlers reply with plain JSON. `run` is the run metadata (provider, model, promptVersion, usage, latency, status) shaped for the `Run` record of the data model. AI routes stay stateless (they work from the snapshots in the request body); the browser persists the run and its output through the project's repository (`runAiAction()` in `src/lib/store/ai-action.ts`), so pure-local and Postgres mode share one code path.

`src/middleware.ts` sits in front of `/api/*`: optional bearer-token auth (`REQUIRE_AUTH`) and a per-IP in-memory rate limit on `/api/ai/*`.

## Persistence Layers

All node content is **items** (plus links, runs and decision events — see [data-model.md](data-model.md)) behind one `Repository` interface. The node page decides where they live, the same way the app always decided whether a database exists:

| | Postgres mode | Pure-local mode |
|---|---|---|
| When | the project row is found by slug (`findProjectBySlug`) | `DATABASE_URL` unset, DB unreachable, or a local-only project |
| projectId | the row's UUID | the decoded URL slug (`localProjectId`) |
| Browser repository | `HttpRepository` → `/api/projects/[id]/*` → `PgRepository` | `LocalRepository`: one `localStorage` value `td:v2:<projectId>` |
| SSR lock state | `completedNodes(items)` from the graph loaded server-side | the `td-done:<slug>` cookie |

`StoreRef` (`src/lib/store/store-ref.ts`) carries the choice to the client; `ProjectStoreProvider` (`src/components/project/ProjectStore.tsx`) loads the graph and runs, reloads after every write, re-derives completion, mirrors it into the cookie in pure-local mode and calls `router.refresh()` when it changed (so a stale or missing cookie — a fresh tab, a fork, an import — corrects itself).

### Postgres (optional)

- Tables: `users`, `projects`, `items`, `links`, `runs`, `decision_events` (`src/lib/db/schema.sql`), accessed through `PgRepository` (`src/lib/db/pg-repository.ts`). Forks copy all four content tables in one transaction (`src/lib/db/fork-project.ts`).
- `src/lib/db/client.ts` — a lazily created singleton `pg.Pool` (created on the first query, 3 s connection timeout) plus `withTransaction()`. Importing the module never throws.
- `query()` **throws** when `DATABASE_URL` is unset or the database is unreachable; callers catch and degrade: the node page falls back to pure-local mode, `/api/projects/[id]/*` answers `503 db_unavailable`, `listProjects()` failures return an empty list plus `db_error`.
- Schema is auto-applied on `docker compose up` via the init script mount.

### Pure-local (no DB)

- **localStorage** `td:v2:<projectId>` — the whole project document (items, links, runs, events), validated on read; see `LocalRepository` in data-model.md.
- **Cookie** `td-done:<slug>` — comma-separated completed `NodeKind`s, a cache of the derived completion (long slugs use `td-done-h:<hash>`; `cookieNameCandidates(slug)` lists the possible names). Overwritten after every write by `writeCompletionCookie()`; read by the SSR page for the lock screen.
- **UI cache** `td:ui:<projectId>:<key>` (`src/lib/store/ui-cache.ts`) — browser conveniences that are not project content: the brief draft, derived copilot follow-ups and their answers, a one-shot import notice.
- Two tabs writing the same project: last write wins.

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
2. SSR decides the store (Postgres row for `my-app` → Postgres mode, else pure-local) and the completed nodes: derived from the project's items in Postgres mode, read from the `td-done:my-app` cookie in pure-local mode.
3. If upstream deps are met, renders `BriefNode`. Otherwise renders `LockedNode`.
4. User interacts; the node component calls `useAiAction().run(…)`, which POSTs to `/api/ai/extract-brief` (and the other brief routes `clarify-brief`, `probe-brief`).
5. The answer's `data` goes through the task's adapter (`src/lib/model/adapters`) into `Repository.saveRunOutput` together with `run`; the provider reloads the items, the UI re-renders from them, and completion / the cookie are re-derived. Accept / reject / edit go through `useItemActions()` the same way.

## Component Hierarchy

```
app/project/[id]/[node]/page.tsx
  └─ shell/TopBar              ← ModelPicker, ExportButton (Markdown / JSON of the graph)
  └─ shell/NavRail             ← ForkButton
  └─ project/ProjectStoreProvider
       └─ <NodeComponent>     ← one of: BriefNode, UsersNode, …, SplitNode (or LockedNode)
            ├─ shared/JudgeBar, ItemDecision / JudgeStrip, UpstreamContext, …
            └─ shell/Copilot  ← AI cards, follow-ups, free-form questions
```
