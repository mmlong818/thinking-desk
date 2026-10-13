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
pnpm test               # vitest run (unit tests live next to the code as *.test.ts; offline prompt evals in evals/)
pnpm eval --model openai:gpt-5.5-2026-04-23 --dry-run  # prompt eval plan + budget; drop --dry-run for a real (paid) run
pnpm build              # next build — must pass without DATABASE_URL / API keys
docker compose up -d db # optional Postgres (auto-runs schema.sql)
```

## Key Directories

```
src/
├── app/
│   ├── api/ai/              # AI route handlers (one dir per task, JSON responses)
│   ├── api/projects/        # project list/create; DELETE [id]; [id]/{graph,runs,items,accept-recommended,fork,links,links/refresh,events} = PgRepository over HTTP
│   ├── api/sources/verify/  # server-side check of cited URLs (SSRF guard, redirects, title match); rate-limited
│   ├── api/providers/       # configured providers + models (structured-task support per model)
│   └── project/[id]/[node]/ # SSR node page: picks the store (Postgres row found → pg, else local), lock state
├── components/
│   ├── nodes/               # BriefNode, UsersNode, … SplitNode (one container per kind + a <kind>/ folder of parts)
│   ├── project/             # ProjectStoreProvider, useNodeData, useAiAction, useItemActions, useNodeStage
│   ├── shared/              # node kit: NodeHat, NodeFrame (redo handlers), ItemDecision (+ 上游已变), JudgeStrip, JudgeBar
│   │                        # (采纳全部推荐, stale / consistency notices, source checks, hints), LinkPicker, UpstreamContext, …
│   └── shell/               # TopBar, NavRail, Copilot, ModelPicker, ConsistencyButton, ExportButton, ForkButton
├── data/nodes.ts            # Source of truth: NODES array, deps, completion rules, formatNodeNum()
└── lib/
    ├── ai/
    │   ├── router.ts        # env-var task→provider:model resolution
    │   ├── providers/       # claude.ts, openai.ts, gemini.ts, zhipu.ts (complete(); stream() on all but Gemini)
    │   ├── schemas/         # client-safe Zod output schemas, types, UI constants (no router/provider imports)
    │   ├── tasks/           # server-only prompt builders that call the AI (import their schema from schemas/)
    │   └── types.ts         # AI_TASKS / AiTask — add new tasks here first
    ├── model/               # Item/Link/Run/DecisionEvent, item-type registry, pure planners (plan-run/-item/-links), link-rules,
    │                        # LocalRepository, adapters/ (task output → item drafts), context (upstream selection), feedback,
    │                        # staleness, consistency (rules) + consistency-context (AI check input) (docs/data-model.md)
    ├── export/              # PRD Markdown + Jira / Linear CSV + GitHub issues from accepted items (docs/exports.md)
    ├── sources/             # URL verifier (server only: verify.ts, ip-guard.ts, title.ts) + client-safe protocol.ts
    ├── store/               # browser side: StoreRef + HttpRepository, runAiAction, completion cookie, UI cache, request payloads
    ├── api/project-api.ts   # handlers behind /api/projects/[id]/* (Zod-validated, repository injected)
    ├── client-model.ts      # client-side model picker helpers
    └── db/                  # lazy Postgres pool, withTransaction, PgRepository, schema.sql (optional; query() throws, callers catch)
```

## Persistence (items, not node blobs)

Every node reads and writes items through one `Repository` (`docs/data-model.md`). The node page picks the store the way the app always decided whether a DB exists: the project row is found in Postgres → **pg** (projectId = row UUID; the browser's `HttpRepository` calls `/api/projects/[id]/*`, backed by `PgRepository`); otherwise → **local** (`LocalRepository`, one `localStorage` value `td:v2:<decoded slug>`).

- AI calls: `useAiAction().run(key, { route, body, node, inputs, adapt })` → POST the `/api/ai/*` route → `adapt(data)` (a `src/lib/model/adapters` function) → `saveRunOutput` with the returned run metadata. Failed calls are recorded as failed runs. Regenerating calls send `feedback: buildFeedback(items, scopes, links)` — pass the links, so kept items whose upstream changed go to the prompt as `revisit`.
- Stale content: a node passes its regenerate actions to `NodeFrame` as `redo={[{ label, types, node?, run, busy }]}`; the "上游已变" badge / node notice offer them as "让 AI 按新内容重做". A new node with AI steps should do the same.
- Link edits: `useItemActions().editLinks({ add, remove })` / `confirmLinks(linkIds)`; allowed pairs come from `LINK_RULES` (the type registry's ref fields + adapter links) — adding a ref field is enough to make a new pair editable.
- Human writes: `useItemActions()` (accept / reject with note / reset / edit body / create / delete / accept recommended).
- Upstream context for prompts: `contextItems(items, node, type)` — accepted items once any is accepted, otherwise every non-rejected one.
- Completion is derived (`completedNodes(items)`); in pure-local mode it is mirrored into the `td-done:<slug>` cookie (`writeCompletionCookie`, long slugs → `td-done-h:<hash>`, `cookieNameCandidates(slug)` to read) so the SSR lock screen works. The provider refreshes the page when the derived set changes.
- UI conveniences that are not content (brief draft, derived follow-ups + answers, import notice) live in `src/lib/store/ui-cache.ts` (`td:ui:<projectId>:<key>`). A failed follow-up derivation is remembered per node until its inputs change or the person presses retry (`follow-ups-state.ts`) — no automatic re-derivation on every visit.

Gotcha: two tabs writing the same local project — last write wins.

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
3. Create `src/components/nodes/YourNode.tsx` (+ a `yournode/` folder for its parts) — copy `StakeholdersNode.tsx` as template: `useNodeData`, `useAiAction`, `JudgeBar`, `JudgeStrip` / `ItemDecision`.
4. Map the new kind in `NODE_COMPONENTS` in `src/app/project/[id]/[node]/page.tsx`.

## Adding an AI Task

1. Add the literal to `AI_TASKS` in `src/lib/ai/types.ts`.
2. Create `src/lib/ai/schemas/your-task.ts` (Zod output schema + types, client-safe) and `src/lib/ai/tasks/your-task.ts` (prompt builder). Components import from `schemas/` only — `schemas/client-safety.test.ts` fails if client code reaches the router or a provider SDK.
3. Create `src/app/api/ai/your-task/route.ts` — `export const POST = aiRoute({ name, body, handle })` from `src/lib/ai/route.ts`; the task calls `runTask()` (`src/lib/ai/run-task.ts`) and wraps request data in `dataBlock()`. Routes answer JSON; `stream: true` additionally offers NDJSON progress to clients that ask (`Accept: application/x-ndjson`) — today only the scenarios route, whose node calls `useAiAction().run(key, { …, stream: true })` and shows `progress` / `cancel`.
4. Write the output adapter in `src/lib/model/adapters/` (output → `ItemDraft[]` + replace scope; test it with the fixtures in `src/lib/ai/schemas/__fixtures__`) and call the route from the node with `useAiAction`.
5. Document `AI_MODEL_YOUR_TASK` in `.env.example`.
6. Add the output fixture to `evals/lib/fixtures.ts` (and a chain step or `EXTRA_PROMPTS` entry), then `pnpm vitest run evals -u` to record its `promptVersion`. Any prompt edit changes that snapshot — update it on purpose.

## AI Model Routing

`src/lib/ai/router.ts` reads `process.env.AI_MODEL_<TASK>`. Format:

- `claude` — auto-pick a model from the Anthropic provider
- `claude:claude-sonnet-5-5` — pin a specific model ID
- Falls back to `AI_MODEL_DEFAULT`, then first configured provider.

## Common Gotchas

- **`formatNodeNum(kind)`** in `data/nodes.ts` generates the `NODE · 08 / 09` header. Do not hardcode node numbers in components.
- **Branching a project** (`ForkButton`): Postgres → `POST /api/projects/[id]/fork` (copies runs, items, links, events); pure-local → `forkLocalProject()` copies `td:v2:<id>` with the projectId rewritten, plus the UI cache.
- **Deleting a project** (home page): Postgres → `DELETE /api/projects/<project id>` (one transaction; the card and browser caches go only after it succeeds or answers 404); pure-local → `purgeProjectClientData(slug)`.
- **Route params are percent-encoded** for non-ASCII slugs — decode (`localProjectId(slug)`) before looking a project up.
- **Turbopack** (`pnpm dev --turbopack`) is the default dev server. If you hit a Turbopack-specific build error, try `pnpm dev` without `--turbopack` to isolate.
- **`src/lib/db/`** — `query()` throws when `DATABASE_URL` is unset or the DB is unreachable (the pool is created lazily on first query, 3 s connect timeout). Every caller must wrap DB calls in try/catch and degrade, so pure-local mode works.
- **No `any`** — TypeScript strict mode. Use `unknown` + type guards or Zod parsing.
- **Styles for the phase-3 review aids** live in `src/app/review.css` (imported after `globals.css`), not in the already very long `globals.css`.
- **`src/lib/sources/verify.ts` is server-only** (node:dns / node:net); the browser uses `src/lib/sources/protocol.ts` and `src/lib/store/source-check.ts`.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | No | Postgres connection string; omit for pure-local mode |
| `ANTHROPIC_API_KEY` | At least one | Claude provider |
| `OPENAI_API_KEY` | At least one | OpenAI provider |
| `GEMINI_API_KEY` | At least one | Google Gemini provider |
| `ZHIPU_API_KEY` | At least one | Zhipu GLM provider |
| `AI_MODEL_DEFAULT` | No | Fallback routing (`provider` or `provider:model`) |
| `AI_MODEL_<TASK>` | No | Per-task override; task names from `AI_TASKS` |
| `REQUIRE_AUTH` / `REQUIRE_AUTH_TOKEN` | No | `middleware.ts`: require `Authorization: Bearer <token>` on `/api/*` |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | No | `middleware.ts`: per-IP in-memory limit on `/api/ai/*` and, in a separate bucket, `/api/sources/*` (default 20 / 60 s) |
| `*_BASE_URL`, `ALLOW_CUSTOM_AI_BASE_URL` | No | Provider endpoints; non-vendor hosts are rejected unless `ALLOW_CUSTOM_AI_BASE_URL=true` |
