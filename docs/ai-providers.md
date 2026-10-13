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

Examples (model IDs checked 2026-10-13):

```bash
AI_MODEL_DEFAULT=claude
AI_MODEL_ALT_SCAN=gemini:gemini-3.8-flash
AI_MODEL_BRIEF_EXTRACT=claude:claude-sonnet-5-5
```

Task names are the `AiTask` string literal union in `src/lib/ai/types.ts`; `.env.example` lists every task in use.

Auto-pick (`AI_MODEL_<TASK>=<provider>`) takes the first curated id the provider lists (`claude-sonnet-5-5` first for Claude), else the newest listed model the adapter can drive (`AiProvider.canDrive`; Zhipu skips `glm-5.3*`).

A per-call `provider:model` override is never silently replaced. It is rejected (a `config` error) only when the provider's real model list does not contain it; when the list is unavailable — empty, a listing error, or the adapter's offline fallback list (entries marked `fallback: true`) — the requested id is sent as is.

`canDrive(modelId) === false` means the adapter cannot drive that model on structured (schema) tasks — today Zhipu `glm-5.3*`, whose thinking cannot be disabled. `runTask()` refuses such a model for a schema task with a `config` error before any provider call, `/api/providers` reports it as `structured: false`, and the model picker shows it as unavailable (every node task is structured).

## Request Parameters

| Provider | Structured output | Sampling / effort | Output budget |
|---|---|---|---|
| Claude | `output_config.format` on models that support it (Fable 5/5.1, Mythos, Opus 5.5/5/4.8/4.5, Sonnet 5.5/5, Haiku 4.5) when the schema has an object root; otherwise schema in the system prompt | per family in `providers/claude-params.ts`: no `temperature` on Sonnet 5.x / Opus 4.7+ / Fable / Mythos; `output_config.effort` `low` on Sonnet 5.x, `medium` on Opus 5.x / Fable / Mythos; `thinking` is never sent; unknown ids get the minimal request | task budget, + 16k on models that think by default (cap 64k) |
| OpenAI | JSON mode (`response_format: json_object`) + schema in the prompt | `temperature` only on 4.x families | `max_completion_tokens` = task budget + 16k on GPT-5+/o-series (reasoning shares the cap) |
| Gemini | `generationConfig.responseJsonSchema` (object roots) or JSON mode + schema in the prompt | task `temperature` | `maxOutputTokens` = task budget + 16k (thinking shares the cap), max 65,536 |
| Zhipu | JSON mode + schema in a system message; `thinking: disabled` for JSON tasks | task `temperature` | task budget (≥ 12k with web search) |

Every answer is validated by `runTask()` against the full Zod schema regardless of the mechanism.

## Streaming

| Provider | `stream()` | How |
|---|---|---|
| Claude | yes | `client.messages.stream(body, { signal, timeout })` with the same body as `complete()`; `text` events are the deltas, `finalMessage()` gives usage and `stop_reason` (claude-api skill, `typescript/claude-api/streaming.md`). `output_config.format` is a plain JSON schema, so the SDK does not parse the answer — `runTask()` does |
| OpenAI | yes | Chat Completions `stream: true` + `stream_options.include_usage`; SSE `data:` chunks (`providers/sse.ts`, `providers/chat-stream.ts`) |
| Zhipu | yes | the same OpenAI-compatible SSE with `stream: true` (usage on the last chunk; no `stream_options`) |
| Gemini | no | `runTask()` falls back to `complete()`; the stream reports `streaming: false` and only the final answer |

A stream that ends before a finish reason or `[DONE]` is a `provider` error (not retried), like any network failure. Aborting the caller's signal aborts the provider request mid-stream. OpenAI's `json_schema` strict mode is not used: it requires every property to be required, which would turn our optional fields into nullable ones.

## Adding a Provider

1. Create `src/lib/ai/providers/your-provider.ts`.
2. Implement the `AiProvider` interface from `src/lib/ai/types.ts` — the contract used by `router.ts`:
   - `name: AiProviderName` — matches the env-var prefix (add the new name to the `AiProviderName` union)
   - `isConfigured(): boolean` — returns `true` if the required env vars are set
   - `listModels(): Promise<ModelInfo[]>` — discover models (the router caches the result for 5 minutes)
   - `complete(model, req): Promise<CompleteResult>` — one request, one full response
   - optional `stream(model, req, onDelta): Promise<CompleteResult>` — the same request streamed: `onDelta` gets each text delta, the result is what `complete()` would return. `runTask()` uses it only when the caller passes `onProgress` and falls back to `complete()` otherwise
3. Register the provider in `src/lib/ai/router.ts` by adding it to the `PROVIDERS` map.
4. Add `YOUR_PROVIDER_API_KEY` and `YOUR_PROVIDER_BASE_URL` to `.env.example`. Custom base URLs are checked by `validate-base-url.ts` (non-vendor hosts need `ALLOW_CUSTOM_AI_BASE_URL=true`).

## Per-Task Prompts

- `src/lib/ai/schemas/<task>.ts` — the Zod output schema, its types and any UI constants. Client-safe: no router or provider imports (`schemas/client-safety.test.ts` enforces it).
- `src/lib/ai/tasks/<task>.ts` — the prompt template and a task function `(args, opts) => runTask({ task, system, messages, schema, … })`. Request-supplied text goes into `dataBlock()` / `dataJson()` (`src/lib/ai/prompt.ts`); `runTask()` appends a guard to every system prompt telling the model to treat `<data>` blocks as material, never as instructions.
- `src/app/api/ai/<task>/route.ts` — `export const POST = aiRoute({ name, body, timeoutMs, handle })`. The factory validates the body with Zod (upstream snapshots use the lenient schemas in `schemas/snapshots.ts`), passes the request's `AbortSignal`, and answers `{ ok: true, data, run }` or `{ error, detail? }` (plus `code` / `run` for AI failures). With `stream: true` a request sent with `Accept: application/x-ndjson` gets the NDJSON progress stream described in `docs/architecture.md` instead (the long steps: scenarios, features, creative-leap, revise-features, generate-design, split-subfeatures).

`runTask()` returns `{ data, text, run }`: `run` carries provider, model, `promptVersion` (hash of the system prompt + output schema), summed usage, latency and status `ok | retried | failed`; `toRunInput(run, { node, inputs })` turns it into a `Run` for `Repository.saveRunOutput`. Failures throw `RunTaskError` with `code`: `config`, `provider`, `invalid_output` (still invalid after the retry), `truncated` (hit the token cap), `refused` (provider safety stop), `timeout`, `aborted`.
