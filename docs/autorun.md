# Headless runs · `/api/autorun`

Runs the whole chain for one idea without the UI — brief → users → stake → alt → scen (3 calls) → feat → leap → revise → design → split, 12 AI calls — and returns the PRD and the design. Each run creates an ordinary Postgres project: open `projectUrl` to judge it like any other.

Code: `src/lib/autorun/` (`chain.ts` is the chain the prompt evals also run), routes under `src/app/api/autorun/`, table `autoruns` in `src/lib/db/schema.sql`.

## Judgment

Between steps the person's judgment is simulated the way the evals do: the AI's recommended items are accepted, plus the items the chain passed on (priority jobs, high-relevance scenario elements, the first three scenarios, priority features, the top leap picks). A node whose completion rule is still unmet takes every item the run produced for it, so the next node unlocks. These acceptances are recorded with `actor: 'ai'` and the note `autorun 自动采纳` — the person's own decisions stay distinguishable in the history.

Each step is saved as the node would save it (`saveRunOutput`, run inputs = the accepted upstream items), and later prompts quote stored items by their permanent ids, so the AI's references become Links.

## API

Auth: with `REQUIRE_AUTH=true` every call needs `Authorization: Bearer <REQUIRE_AUTH_TOKEN>`. `/api/autorun` is not rate-limited. Without `DATABASE_URL` every call answers 503.

### `POST /api/autorun`

```json
{ "name": "≤120 chars", "rawText": "≤20000 chars", "model": "zhipu:glm-5.3" }
```

`model` is optional (`provider` or `provider:model`, else the `AI_MODEL_<TASK>` routing). Answers `202 { runId, projectId, slug, statusUrl }`, or `400 { error, issues }`.

### `GET /api/autorun/<runId>`

```ts
{
  runId, projectId, slug,
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled',
  currentStep: string | null,
  steps: { step, task, status: 'pending' | 'running' | 'ok' | 'retried' | 'failed' | 'skipped',
           provider?, model?, latencyMs?, usage?: { inputTokens, outputTokens }, error? }[],
  error?: string,
  projectUrl: string,          // the project's 08 design node
  createdAt, updatedAt,        // ISO
  result?: {                   // once done
    prdMarkdown: string,
    design: { sections: Item[], modules: Item[] },   // accepted design_section / module items
    split?: { subtasks: Item[] },                    // accepted subtask items
  },
}
```

`usage` adds up every attempt of the step, the validation retry included. A step whose inputs failed is `skipped`. Without a design the run is `failed`; a failed split still ends `done`, without `result.split`, and `error` says why. 404 for an unknown run.

### `POST /api/autorun/<runId>/cancel`

`202 { status: 'cancelled' }`: the current AI call is aborted; items already written stay. `409` when the run had already ended.

### Restarts

Runs live in the server process. On the first autorun request after a restart, runs left `queued` / `running` become `failed` with `error: 'server_restarted'`; they are not resumed — start a new run.

## Settings

| Variable | Default | |
|---|---|---|
| `AUTORUN_PUBLIC_URL` | the POST's origin | origin written into `projectUrl` |
| `AUTORUN_CONCURRENCY` | 2 | chains running at once; later ones wait `queued` |

Each step may take up to 15 minutes (`AUTORUN_STEP_TIMEOUT_MS`). An existing database gets the `autoruns` table with `pnpm db:init`.

## Example

```bash
curl -s -X POST http://localhost:3000/api/autorun \
  -H 'authorization: Bearer <token>' -H 'content-type: application/json' \
  -d '{"name":"错题本","rawText":"……","model":"zhipu:glm-5.3"}'
curl -s http://localhost:3000/api/autorun/<runId> -H 'authorization: Bearer <token>'
```
