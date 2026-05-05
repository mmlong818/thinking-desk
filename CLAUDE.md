# Thinking Desk — Agent Context

**Version:** 0.1.0 | **Port:** 3000 | **Stack:** Next.js 15 + React 19 + TypeScript + Tailwind + Postgres (optional)

## What

Alpha product-thinking tool. 9 sequential nodes walk a user through problem clarification → design → task breakdown. AI co-pilot (right panel) asks one question at a time. UI is in Chinese; code and identifiers are English.

## Quick Start

```bash
./setup.sh              # install deps, create .env
pnpm dev                # http://localhost:3000
pnpm typecheck          # tsc --noEmit
pnpm lint               # next lint
docker compose up -d db # optional Postgres (auto-runs schema.sql)
```

## Key Directories

```
src/
├── app/
│   ├── api/ai/              # Streaming AI route handlers (one dir per task)
│   └── project/[id]/[node]/ # SSR node pages; reads cookie for lock state
├── components/
│   ├── nodes/               # BriefNode, UsersNode, … SplitNode (one per kind)
│   └── shell/               # TopBar, NavRail, Copilot, ModelPicker, ExportButton
├── data/nodes.ts            # Source of truth: NODES array, deps, formatNodeNum()
└── lib/
    ├── ai/
    │   ├── router.ts        # env-var task→provider:model resolution
    │   ├── providers/       # anthropic.ts, openai.ts, gemini.ts, zhipu.ts
    │   ├── tasks/           # prompt + Zod schema per task
    │   └── types.ts         # AiTask union — add new tasks here first
    ├── client-cache.ts      # sessionStorage R/W + cookie completion flags
    ├── client-model.ts      # client-side model picker helpers
    └── db/                  # Postgres pool + schema.sql (gracefully optional)
```

## Pure-Local Mode (no Postgres)

When `DATABASE_URL` is absent or the DB is unreachable the app falls back to:

1. **sessionStorage** keyed `td:<projectSlug>:<nodeKind>` — stores node output JSON.
2. **Cookie** `td-done:<slug>` — comma-separated list of completed `NodeKind`s.
   - Written client-side by `writeCache()` in `client-cache.ts`.
   - Read server-side by `app/project/[id]/[node]/page.tsx` to skip the lock screen.
   - Contains only kind names (no content) — stays well under 4 KB.

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
2. Push a `NodeDef` to `NODES` with correct `deps`.
3. Create `src/components/nodes/YourNode.tsx` — copy `BriefNode.tsx` as template.
4. Map the new kind in `src/app/project/[id]/[node]/page.tsx`.

## Adding an AI Task

1. Add literal to `AiTask` in `src/lib/ai/types.ts`.
2. Create `src/lib/ai/tasks/your-task.ts` — prompt builder + Zod schema.
3. Create `src/app/api/ai/your-task/route.ts` — streaming POST handler.
4. Document `AI_MODEL_YOUR_TASK` in `.env.example`.

## AI Model Routing

`src/lib/ai/router.ts` reads `process.env.AI_MODEL_<TASK>`. Format:

- `claude` — auto-pick a model from the Anthropic provider
- `claude:claude-sonnet-4-5` — pin a specific model ID
- Falls back to `AI_MODEL_DEFAULT`, then first configured provider.

## Common Gotchas

- **`formatNodeNum(kind)`** in `data/nodes.ts` generates the `NODE · 08 / 09` header. Do not hardcode node numbers in components.
- **`forkCache(fromSlug, toSlug)`** copies all sessionStorage entries when branching a project — call this before navigating to the new slug.
- **Turbopack** (`pnpm dev --turbopack`) is the default dev server. If you hit a Turbopack-specific build error, try `pnpm dev` without `--turbopack` to isolate.
- **`src/lib/db/`** — all DB calls must be graceful; wrap in try/catch and fall back to `null` so pure-local mode works.
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
