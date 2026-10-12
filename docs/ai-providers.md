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

Each AI task lives in `src/lib/ai/tasks/<task-name>.ts` and exports:

- A prompt builder / task function that receives the current node state and calls `runAi()`.
- A Zod schema for the expected response structure.

The route handler in `src/app/api/ai/<task>/route.ts` validates the request, calls the task function, and returns the full result as JSON.
