# AI Providers

## Supported Providers

| Slug | Provider | Adapter |
|------|----------|---------|
| `claude` | Anthropic | `src/lib/ai/providers/anthropic.ts` |
| `openai` | OpenAI | `src/lib/ai/providers/openai.ts` |
| `gemini` | Google Gemini | `src/lib/ai/providers/gemini.ts` |
| `zhipu` | Zhipu AI (GLM) | `src/lib/ai/providers/zhipu.ts` |

Configure any combination in `.env`. Providers with no key set are silently skipped.

## Routing

`src/lib/ai/router.ts` resolves a `{ provider, modelId }` pair for each request:

1. Read `process.env.AI_MODEL_<TASK>` (e.g. `AI_MODEL_ALT_SCAN`).
2. If unset, fall back to `AI_MODEL_DEFAULT`.
3. If neither is set, pick the first provider that has a key configured.

### Format

```
AI_MODEL_<TASK>=<provider>              # auto-select model
AI_MODEL_<TASK>=<provider>:<model-id>  # pin a specific model
```

Examples:

```bash
AI_MODEL_DEFAULT=claude
AI_MODEL_ALT_SCAN=gemini:gemini-2.5-pro
AI_MODEL_HISTORY_SEARCH=zhipu:glm-4-plus
AI_MODEL_BRIEF_EXTRACT=claude:claude-sonnet-4-5
```

Task names are the `AiTask` string literal union in `src/lib/ai/types.ts`.

## Adding a Provider

1. Create `src/lib/ai/providers/your-provider.ts`.
2. Implement the `Provider` interface — the contract used by `router.ts`:
   - `slug: string` — matches the env-var prefix
   - `isConfigured(): boolean` — returns `true` if the required env vars are set
   - `stream(messages, options): AsyncIterable<string>` — yields text chunks
3. Register the provider in `src/lib/ai/router.ts` by adding it to the provider map.
4. Add `YOUR_PROVIDER_API_KEY` and `YOUR_PROVIDER_BASE_URL` to `.env.example`.

## Per-Task Prompts

Each AI task lives in `src/lib/ai/tasks/<task-name>.ts` and exports:

- A prompt builder function that receives the current node state.
- A Zod schema for the expected response structure.

The route handler in `src/app/api/ai/<task>/route.ts` calls the prompt builder, passes it to the router, and streams the result back to the client.
