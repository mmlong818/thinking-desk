# Thinking Desk · 思考工作台

> A structured design-thinking workbench where the AI does the heavy lifting — and you make the calls.

> AI 主导产出的结构化设计思考工作台——AI 给出分析、方案与理由，由你来判断与裁决。

---

## What is this? · 这是什么？

Thinking Desk guides you through a **9-node design methodology** — from a raw brief all the way to an executable task breakdown. At each step the AI draws on knowledge far wider than any one person holds: it produces the analysis, proposes options and explains its reasons. You judge and decide.

思考工作台通过**九节点设计方法论**，带你从一份粗糙的项目简报，走到可执行的任务拆分。每一步由 AI 发挥知识面广的优势：给出分析、提出选项并说明理由；由你来判断与裁决。

Each node is a structured workspace. The AI drafts the first version — analysis, options and the reasoning behind them. You review it, edit, keep or reject items, and ask for another pass. The output is a chain of decisions you can trace back and export.

每个节点都是一个结构化工作区：AI 先给出初稿——分析、选项以及背后的理由；你审阅、修改、取舍，并可要求再来一轮。最终产出是一条可追溯、可导出的决策链。

---

## Who is it for? · 适合哪些人？

| Role · 角色 | How it helps · 怎么用 |
|---|---|
| **Product managers · 产品经理** | Turn vague requirements into structured, defensible specs / 把模糊需求变成有据可查的产品规格 |
| **Designers · 设计师** | Stress-test problem framing before jumping to solutions / 在跳到方案之前先把问题定义压力测试一遍 |
| **Founders · 创业者** | Validate assumptions before building / 动手之前先验证假设 |
| **Researchers · 研究者** | Systematically map stakeholders, scenarios, and alternatives / 系统化地梳理干系人、情景与替代方案 |
| **Teams · 团队** | A shared thinking record anyone can pick up mid-stream / 可随时接手的共享思考记录 |

**Not for:** pure content generation, coding assistance, or quick Q&A. Thinking Desk is built for product-thinking work: the AI proposes, but the output only counts once a person has judged and decided.

**不适合：** 纯内容生成、编程辅助或快问快答。思考工作台面向产品思考：AI 负责提案，只有经过人的判断与裁决，产出才算数。

---

## The 9 Nodes · 九节点

```
Brief → Users & Jobs → Stakeholders → Alternatives
  → Scenarios → Feature List → Creative Leap → Design Proposal → Subfeature Split
```

| # | Node · 节点 | Purpose · 目的 |
|---|---|---|
| 01 | Brief | Extract structure from raw input · 从原始输入中抽取结构 |
| 02 | Users & Jobs | Map who needs what, and why · 梳理谁需要什么、为什么 |
| 03 | Stakeholders | Surface hidden interests and tensions · 暴露隐藏的利益与张力 |
| 04 | Alternatives | What already exists; what you're really up against · 现有方案；你真正面对的竞争 |
| 05 | Scenarios | Concrete use moments — including pain points · 具体使用时刻，包括痛点 |
| 06 | Feature List | The conventional market feature set, scored with Kano and RICE · 基于情景的功能草稿 |
| 07 | Creative Leap | Reframe via first principles, analogies and constraint flips · 用第一性原理、类比迁移与约束反转重构 |
| 08 | Design Proposal | Turn features into a full design document · 把功能整合成完整设计案 |
| 09 | Subfeature Split | Break the design into executable tasks · 把设计拆成可执行的子功能任务 |

The whole chain can be exported as Markdown or JSON from the top bar.

整条思考链可从顶栏导出为 Markdown 或 JSON。

---

## Model Recommendations · 模型选择建议

Thinking Desk routes different AI tasks to different models. Here is what works well (model IDs checked 2026-10-13):

思考工作台对不同任务路由不同模型，以下是推荐配置（模型 ID 核对于 2026-10-13）：

### Recommended setup · 推荐配置

```env
# Default for every task — Claude is the best choice for structured JSON output
# 所有任务的默认模型 —— Claude 是结构化 JSON 输出的最佳选择
AI_MODEL_DEFAULT=claude:claude-sonnet-5-5

# Optional per-task pins (any task in AI_TASKS, see .env.example)
# 可选的按任务指定（AI_TASKS 中的任意任务，完整列表见 .env.example）
AI_MODEL_BRIEF_EXTRACT=claude:claude-sonnet-5-5
AI_MODEL_USERS_JTBD=claude:claude-sonnet-5-5
AI_MODEL_STAKE_MATRIX=claude:claude-sonnet-5-5
AI_MODEL_SCEN_FEED=claude:claude-sonnet-5-5
AI_MODEL_FEAT_DRAFT=claude:claude-sonnet-5-5
AI_MODEL_LEAP_FIRST_PRINCIPLES=claude:claude-sonnet-5-5

# Web search task — Gemini has Google Search grounding built in
# 联网搜索任务 —— Gemini 内置 Google 搜索接地
AI_MODEL_ALT_SCAN=gemini:gemini-3.8-flash
```

### Why these models? · 为什么选这些模型？

**Claude (Anthropic) — default for most tasks**
Claude produces tight, structured JSON output with strong reasoning and follows complex prompts faithfully. `claude-sonnet-5-5` is the default: the Claude adapter picks request parameters per model family (no sampling parameters where they are rejected, native structured output via `output_config.format`, adaptive thinking at `low` effort), so any current Claude model works. Use `claude-opus-5-5` (runs at `medium` effort) for deeper reasoning on hard problems.

**Claude（Anthropic）—— 大多数任务的默认选择**
Claude 能生成紧凑的结构化 JSON 输出，推理能力强，忠实遵循复杂提示词。默认用 `claude-sonnet-5-5`：Claude 适配器按模型家族选择请求参数（不支持采样参数的模型不传 `temperature`，原生结构化输出走 `output_config.format`，自适应思考 + `low` effort），当前任意 Claude 模型都能直接用。复杂问题可换 `claude-opus-5-5`（`medium` effort）。

**Gemini (Google) — web search task**
The `ALT_SCAN` task needs real-time competitive intelligence. The Gemini adapter enables Google Search grounding for it, which makes Gemini the right tool for this specific job. `gemini-3.8-flash` is the current GA fast model. For all other tasks, Claude or OpenAI is preferred.

**Gemini（Google）—— 联网搜索任务**
`ALT_SCAN` 任务需要实时竞品情报。Gemini 适配器会为它启用 Google 搜索接地，因此 Gemini 是这个任务的最佳选择。`gemini-3.8-flash` 是当前 GA 的快速模型。其他任务仍推荐 Claude 或 OpenAI。

**Zhipu GLM (智谱) — Chinese-language alternative**
GLM models are optimized for Chinese and are cost-effective. Use `glm-5.2` (not `glm-5.3`: its thinking cannot be disabled, while the Zhipu adapter sends `thinking: disabled` for JSON tasks). The adapter also supports web search for `ALT_SCAN`.

**智谱 GLM —— 中文场景备选**
GLM 系列针对中文优化，性价比高。推荐 `glm-5.2`（不要用 `glm-5.3`：它的思考不可关闭，而智谱适配器在 JSON 任务里会传 `thinking: disabled`）。适配器同样支持 `ALT_SCAN` 的联网搜索。

### OpenAI as an alternative · OpenAI 作为替代

If you only have an OpenAI key, set:
```env
AI_MODEL_DEFAULT=openai:gpt-6.1-sol
```
`gpt-6.1-sol` is OpenAI's recommended sub-flagship ("near-Astra" quality at $2/$10 per 1M tokens). The OpenAI adapter does not request web search, so `ALT_SCAN` runs without live search; use Gemini or Zhipu for that task if you need it.

如果你只有 OpenAI 的 key，设置 `AI_MODEL_DEFAULT=openai:gpt-6.1-sol` 即可。`gpt-6.1-sol` 是 OpenAI 当前推荐的次旗舰（接近 Astra 的质量，$2/$10 每百万 token）。OpenAI 适配器不发起联网搜索，`ALT_SCAN` 会在无实时搜索的情况下运行；需要搜索请用 Gemini 或智谱。

---

## Quick Start · 快速启动

### Option A: Local dev · 本地开发

Requires Node 22+ and pnpm.

```bash
git clone https://github.com/mmlong818/thinking-desk.git
cd thinking-desk
cp .env.example .env
# Edit .env — add at least one API key
pnpm install
pnpm dev                       # http://localhost:3000
```

Postgres is optional. Without `DATABASE_URL` the app runs in pure-local mode: each project lives in the browser's localStorage (items, links, runs, decisions), plus a completion cookie for the lock screen. To add Postgres:

Postgres 是可选的。未设置 `DATABASE_URL` 时应用以纯本地模式运行：每个项目保存在浏览器 localStorage 里（条目、链接、运行记录与裁决），另有一个完成状态 cookie 供锁定页使用。如需接入 Postgres：

```bash
docker compose up -d db        # local Postgres; schema.sql is applied on first boot
```

Checks run by CI (and worth running before a PR) · CI 会执行的检查：

```bash
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

### Option B: Docker · Docker 部署

```bash
cp .env.example .env
# Edit .env — add API keys
docker compose up -d --build
# Open http://<your-host>:3000
```

The `db-data` volume persists your projects. The schema runs automatically on first boot.

`db-data` 卷会持久化你的项目数据，schema 在首次启动时自动执行。

---

## Configuration · 配置说明

All configuration is via environment variables. Copy `.env.example` to `.env` and fill in the values.

所有配置通过环境变量完成。将 `.env.example` 复制为 `.env` 后填入对应值。

### Required · 必填

```env
# At least one of: · 至少填一个：
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
ZHIPU_API_KEY=
```

### Optional · 可选

```env
# Omit for pure-local mode (no Postgres). · 不填则为纯本地模式（无需 Postgres）。
DATABASE_URL=postgres://desk:desk@localhost:5432/thinking_desk
```

### Behind an HTTP(S) proxy · 代理环境

Node's built-in `fetch`, which the provider adapters use, ignores `HTTPS_PROXY` / `HTTP_PROXY` unless Node starts with `NODE_USE_ENV_PROXY=1` (Node ≥ 22.21 or 24). Without it, AI calls through a proxy fail with `fetch failed` (`UND_ERR_CONNECT_TIMEOUT`). Set it in the environment that starts Node — no proxy package is needed:

Node 内置的 `fetch`（各 provider 适配器都用它）默认忽略 `HTTPS_PROXY` / `HTTP_PROXY`，除非 Node 启动时带上 `NODE_USE_ENV_PROXY=1`（Node ≥ 22.21 或 24）。不加的话，经代理的 AI 请求会报 `fetch failed`（`UND_ERR_CONNECT_TIMEOUT`）。在启动 Node 的环境里设置即可，无需安装代理依赖：

```bash
NODE_USE_ENV_PROXY=1 pnpm dev        # or: NODE_USE_ENV_PROXY=1 pnpm start
```

### Security (for public deployments) · 安全（公开部署时建议开启）

```env
REQUIRE_AUTH=true
REQUIRE_AUTH_TOKEN=your-secret-token   # clients send: Authorization: Bearer <token>
RATE_LIMIT_MAX=20                      # requests per window per IP
RATE_LIMIT_WINDOW_MS=60000
```

With Docker, set these in `.env` next to `docker-compose.yml`; the `app` service forwards them, along with every `AI_MODEL_<TASK>` override and `ALLOW_CUSTOM_AI_BASE_URL`.

使用 Docker 时，在 `docker-compose.yml` 同目录的 `.env` 里设置即可；`app` 服务会透传这些变量，以及全部 `AI_MODEL_<TASK>` 覆盖项和 `ALLOW_CUSTOM_AI_BASE_URL`。

---

## Project Structure · 目录结构

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── project/[id]/[node]/page.tsx
│   └── api/
│       ├── ai/                  # one route per AI task
│       ├── projects/            # project list / create; [id]/… items, runs, fork (Postgres mode)
│       └── providers/           # configured providers + models
├── middleware.ts                # optional bearer auth + per-IP rate limit for /api
├── components/
│   ├── shell/                   # TopBar · NavRail · Copilot · ModelPicker · ExportButton
│   ├── project/                 # project store provider + hooks (items, AI actions, decisions)
│   ├── shared/                  # node kit: decision controls, judge bar, upstream context …
│   └── nodes/                   # Per-node workspace UI
├── lib/
│   ├── ai/
│   │   ├── providers/           # claude.ts / openai.ts / gemini.ts / zhipu.ts adapters
│   │   ├── router.ts            # task → provider:model routing
│   │   ├── tasks/               # prompt + schema per AI task
│   │   └── types.ts
│   ├── model/                   # items / links / runs / decisions, planners, LocalRepository, task adapters
│   ├── store/                   # browser side: repository over HTTP, AI actions, completion cookie
│   └── db/
│       ├── schema.sql
│       ├── client.ts            # lazy pg Pool
│       ├── pg-repository.ts     # Repository over Postgres
│       └── projects.ts
└── data/
    └── nodes.ts                 # 9-node definitions
```

---

## Adding a new AI task · 新增 AI 任务

1. Add a literal to `AI_TASKS` in `src/lib/ai/types.ts`
2. Write the Zod schema in `src/lib/ai/schemas/xxx.ts` and the prompt in `src/lib/ai/tasks/xxx.ts` (calls `runTask()`)
3. Expose a server route at `src/app/api/ai/xxx/route.ts` with `aiRoute()`
4. Write an output adapter in `src/lib/model/adapters/` (task output → items) and call the route from the node with `useAiAction()`
5. Optionally pin a model: `AI_MODEL_XXX=provider:model` in `.env` (and document it in `.env.example`)

---

## Tech Stack · 技术栈

- **Next.js 15** (App Router + Turbopack) · React 19 · TypeScript 5
- **Tailwind CSS 3**
- **Postgres 16** (optional) — projects plus the Phase 1 data model (items, links, runs, decision events; see `docs/data-model.md`)
- **@anthropic-ai/sdk** for Claude; OpenAI, Gemini and Zhipu are called with plain `fetch`
- **Vitest** for unit tests · **ESLint** (`next/core-web-vitals`) · GitHub Actions CI

---

## License

[AGPL-3.0](LICENSE) — free to use and modify with attribution; commercial use requires the full source to remain open under the same license.
