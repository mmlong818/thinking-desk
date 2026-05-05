# Contributing to Thinking Desk

Thank you for your interest. This is an alpha-stage research tool — contributions that deepen the methodology or improve the developer experience are especially welcome.

## Development Setup

```bash
git clone https://github.com/your-org/thinking-desk.git
cd thinking-desk
./setup.sh
# Edit .env — add at least one AI provider key
pnpm dev
```

Optional Postgres:

```bash
docker compose up -d db
```

Type-check before committing:

```bash
pnpm typecheck
pnpm lint
```

## Code Style

- **TypeScript strict mode** — `noImplicitAny` is enforced. No `any` escapes.
- **Immutable updates** — never mutate state in place; return new objects/arrays.
- **No deep nesting** — prefer early returns over nested conditionals.
- **Small files** — aim for 200–400 lines; 800 is the hard ceiling.
- **Small functions** — under 50 lines. Extract named helpers over inline complexity.
- **No console.log** — use structured error objects or remove before committing.

## How to Add a New Node

1. Add a new `NodeKind` literal to the union in `src/data/nodes.ts`.
2. Add a `NodeDef` entry to the `NODES` array — set `deps` to enforce ordering.
3. Create `src/components/nodes/YourNode.tsx` following the pattern of an existing node (e.g. `BriefNode.tsx`).
4. Register the component in `src/app/project/[id]/[node]/page.tsx`.
5. Add any new AI tasks (see below) and wire them through the Copilot panel.

## How to Add a New AI Task

1. Add a literal to the `AiTask` union in `src/lib/ai/types.ts`.
2. Create `src/lib/ai/tasks/your-task.ts` — export a prompt builder and a Zod response schema.
3. Create `src/app/api/ai/your-task/route.ts` — a streaming `POST` handler that calls `router.ts`.
4. Call the route from your node component via `fetch`.
5. Document the new `AI_MODEL_YOUR_TASK` variable in `.env.example`.

## How to Add a New AI Provider

1. Create `src/lib/ai/providers/your-provider.ts` — implement the shared `Provider` interface (see `anthropic.ts` for reference).
2. Register the provider slug in `src/lib/ai/router.ts`.
3. Add the key/base-url env vars to `.env.example`.

## Branching and PR Process

- Branch from `main`: `feat/short-description` or `fix/short-description`.
- Keep PRs focused — one logical change per PR.
- Run `pnpm typecheck && pnpm lint` and confirm they pass before opening a PR.
- Describe *why*, not just *what*, in the PR body.
- For UI changes, include a screenshot or short screen recording.

## Reporting Issues

Use the GitHub issue templates:
- **Bug report** — steps to reproduce, environment, expected vs actual behaviour.
- **Feature request** — problem statement, proposed solution, alternatives considered.

## Using Claude Code

This repo includes `CLAUDE.md` which gives Claude Code full project context. Run:

```bash
claude
```

Claude Code will read `CLAUDE.md` automatically and understand node structure, the pure-local persistence model, and task routing conventions.
