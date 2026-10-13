# Prompt evals

A baseline for judging prompt changes on the same inputs. Two halves:

| | Runs | Calls an API | What it checks |
|---|---|---|---|
| Offline (`evals/offline.test.ts`; budgets in `evals/budget.test.ts`) | `pnpm test` (CI) | never | every task schema accepts its fixtures; every prompt builder renders for every golden brief (chain steps + clarify / probe / refine / "more" runs / follow-ups / free ask / the consistency check over the chain's brief, red lines, revised features and subtasks); each prompt's `promptVersion` is the same for every brief and matches `__snapshots__/offline.test.ts.snap` |
| Online (`evals/run-eval.ts`) | `pnpm eval` (by hand) | yes, unless `--dry-run` | runs the brief → users → stake → alt → scenarios (exhaust, combine, deep) → features → leap → revise → design → split chain for each golden brief and saves outputs + run metadata |

A prompt or output-schema change changes its `promptVersion`, so the snapshot test fails until the snapshot is updated (`pnpm vitest run evals -u`) — the diff shows in review which prompts changed. Online results record the same `promptVersion` per call, so two runs can be compared prompt by prompt.

## Golden briefs

`evals/briefs/*.md` — five raw briefs in Chinese, first line `# <title>`: consumer app (一人食备餐), B2B SaaS (连锁茶饮排班), hardware-adjacent (智能药盒), internal tool (采购审批), non-profit (乡村图书捐赠). Each mixes clear facts, gaps and at least one red line, the way a pasted brief does.

## Online run

```bash
pnpm eval --model openai:gpt-5.5-2026-04-23 --dry-run      # plan + token / cost budget, no API call
pnpm eval --model zhipu:glm-5.2                             # real run (paid)
pnpm eval --model claude:claude-sonnet-5-5 --briefs 01,03   # a subset of the briefs
pnpm eval --model openai:gpt-6.1-sol --model zhipu:glm-5.2  # several models, one after the other
```

- `--model provider:model` (repeatable) is required: results are always pinned to a model. Keys come from the environment, else from `.env` (environment wins; the dry run reads neither).
- `--dry-run` runs the chain against canned outputs, renders every request exactly as that provider's adapter would send it, and prints the call count (60 for 5 briefs × 12 steps; at most twice that with the one validation retry) plus an expected and a worst-case token budget and cost. Assumptions are printed under the table.
- `--briefs 01,03` picks briefs by id prefix; `--out <dir>` changes the results root (default `evals/results/`, gitignored); `--price <in>,<out>` sets USD per 1M tokens for a model not in `evals/lib/pricing.ts`.
- Between steps the person's judgment is simulated as the AI-led default: accept what the AI recommends (priority jobs, high-relevance scenario elements, priority features, top leap picks), everything when it recommends nothing; the first three scenarios are deepened. A step whose input failed is skipped.
- Each step has the routes' 290 s deadline and `runTask()`'s one validation retry.

Results: `evals/results/<timestamp>/<provider_model>/<brief>/<NN>-<step>.json` (status, run metadata — provider, model, promptVersion, usage, latency, attempts, error — and the validated output), `run.json` (all run metadata) and `summary.txt` (the table printed at the end: per-step ok / retried / failed / skipped, average latency, tokens; per-brief result; total usage and a rough cost from list prices).

Behind an HTTP(S) proxy, start Node with `NODE_USE_ENV_PROXY=1` in the environment (Node ≥ 22.21 or 24; see the README's proxy section) — it must be set before Node starts, so `.env` cannot carry it:

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:7890 pnpm eval --model zhipu:glm-5.2
```

`pnpm eval` compiles `run-eval.ts` with `evals/tsconfig.json` (CommonJS into `node_modules/.cache/td-evals`) and runs it with plain `node`; no extra dependency.
