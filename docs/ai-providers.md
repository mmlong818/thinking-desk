# AI Providers

## Supported Providers

| Slug | Provider | Adapter |
|------|----------|---------|
| `claude` | Anthropic | `src/lib/ai/providers/claude.ts` |
| `openai` | OpenAI | `src/lib/ai/providers/openai.ts` |
| `gemini` | Google Gemini | `src/lib/ai/providers/gemini.ts` |
| `zhipu` | Zhipu AI (GLM) | `src/lib/ai/providers/zhipu.ts` |

Configure any combination in `.env`. Providers with no key set are silently skipped. The Claude adapter uses `@anthropic-ai/sdk`; the other three call the vendor HTTP API with plain `fetch`.

## Routing

`src/lib/ai/router.ts` resolves a `{ provider, model }` pair for each request:

1. A per-call override from the model picker, if present.
2. Otherwise `process.env.AI_MODEL_<TASK>` (e.g. `AI_MODEL_ALT_SCAN`).
3. If unset, fall back to `AI_MODEL_DEFAULT`.
4. If neither is set, pick the first provider that has a key configured (order: claude, openai, gemini, zhipu).

### Format

```
AI_MODEL_<TASK>=<provider>              # auto-select a model
AI_MODEL_<TASK>=<provider>:<model-id>  # pin a specific model
```

Examples (model IDs checked 2026-10-12):

```bash
AI_MODEL_DEFAULT=claude
AI_MODEL_ALT_SCAN=gemini:gemini-3.8-flash
AI_MODEL_BRIEF_EXTRACT=claude:claude-sonnet-4-6
```

Task names are the `AiTask` string literal union in `src/lib/ai/types.ts`; `.env.example` lists every task in use.

## Adding a Provider

1. Create `src/lib/ai/providers/your-provider.ts`.
2. Implement the `AiProvider` interface from `src/lib/ai/types.ts` — the contract used by `router.ts`:
   - `name: AiProviderName` — matches the env-var prefix (add the new name to the `AiProviderName` union)
   - `isConfigured(): boolean` — returns `true` if the required env vars are set
   - `listModels(): Promise<ModelInfo[]>` — discover models (the router caches the result for 5 minutes)
   - `complete(model, req): Promise<CompleteResult>` — one request, one full response (no streaming)
3. Register the provider in `src/lib/ai/router.ts` by adding it to the `PROVIDERS` map.
4. Add `YOUR_PROVIDER_API_KEY` and `YOUR_PROVIDER_BASE_URL` to `.env.example`. Custom base URLs are checked by `validate-base-url.ts` (non-vendor hosts need `ALLOW_CUSTOM_AI_BASE_URL=true`).

## Per-Task Prompts

- `src/lib/ai/schemas/<task>.ts` — the Zod output schema, its types and any UI constants. Client-safe: no router or provider imports (`schemas/client-safety.test.ts` enforces it).
- `src/lib/ai/tasks/<task>.ts` — the prompt template and a task function `(args, opts) => runTask({ task, system, messages, schema, … })`. Request-supplied text goes into `dataBlock()` / `dataJson()` (`src/lib/ai/prompt.ts`); `runTask()` appends a guard to every system prompt telling the model to treat `<data>` blocks as material, never as instructions.
- `src/app/api/ai/<task>/route.ts` — `export const POST = aiRoute({ name, body, timeoutMs, handle })`. The factory validates the body with Zod (upstream snapshots use the lenient schemas in `schemas/snapshots.ts`), passes the request's `AbortSignal`, and answers `{ ok: true, data, run }` or `{ error, detail? }` (plus `code` / `run` for AI failures).

`runTask()` returns `{ data, text, run }`: `run` carries provider, model, `promptVersion` (hash of the system prompt + output schema), summed usage, latency and status `ok | retried | failed`; `toRunInput(run, { node, inputs })` turns it into a `Run` for `Repository.saveRunOutput`. Failures throw `RunTaskError` with `code`: `config`, `provider`, `invalid_output` (still invalid after the retry), `truncated` (hit the token cap), `refused` (provider safety stop), `timeout`, `aborted`.
