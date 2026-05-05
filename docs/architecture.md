# Architecture

## Overview

Thinking Desk is a Next.js 15 App Router application. The front-end and back-end share one process. AI calls are made server-side via route handlers (never directly from the browser).

```
Browser
  │
  ├─ GET /project/[id]/[node]
  │    └─ SSR (page.tsx) reads lock state from cookie → renders node or lock screen
  │
  └─ POST /api/ai/<task>
       └─ router.ts resolves provider:model from env
            └─ provider adapter streams response back as NDJSON / SSE
```

## Persistence Layers

Two independent persistence strategies; the app uses whichever is available.

### Postgres (preferred)

- Node output and AI conversation logs stored server-side.
- `src/lib/db/client.ts` — singleton `pg.Pool`; all queries wrapped in try/catch.
- Schema is auto-applied on `docker compose up` via the init script mount.
- If the pool cannot connect, every DB function returns `null` and the app falls through to the local layer.

### Pure-local (no DB)

- **sessionStorage** — node output JSON, keyed `td:<projectSlug>:<nodeKind>`.
- **Cookie** `td-done:<slug>` — comma-separated completed `NodeKind`s.
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
       returns { provider, modelId }
  │
  └─ providers/<name>.ts
       implements Provider interface: stream(prompt, schema) → AsyncIterable<chunk>
```

Adding a provider: implement the `Provider` interface and register the slug in `router.ts`.

## Request Flow (node page)

1. User navigates to `/project/my-app/brief`.
2. SSR reads `td-done:my-app` cookie → determines which nodes are complete.
3. If upstream deps are met, renders `BriefNode`. Otherwise renders `LockedNode`.
4. User interacts; node component POSTs to `/api/ai/brief-extract`.
5. Streamed response updates UI; on save, `writeCache()` writes to sessionStorage and updates the cookie.

## Component Hierarchy

```
app/project/[id]/[node]/page.tsx
  └─ shell/TopBar
  └─ shell/NavRail
  └─ <NodeComponent>          ← one of: BriefNode, UsersNode, …, SplitNode
       └─ shell/Copilot       ← AI Q&A panel (right side)
            └─ shell/ModelPicker
```
