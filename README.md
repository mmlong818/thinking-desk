# Thinking Desk · 思考工作台

> A structured design-thinking workbench with AI as a thinking partner — not an answer machine.

> AI 陪伴下的结构化设计思考工作台——AI 是思考伙伴，不是答题机。

---

## What is this? · 这是什么？

Thinking Desk guides you through a **9-node design methodology** — from a raw brief all the way to a validated feature list — with AI that challenges assumptions, surfaces blind spots, and helps you think more rigorously.

思考工作台通过**九节点设计方法论**，带你从一份粗糙的项目简报，走到经过验证的功能列表。AI 的角色是质疑假设、暴露盲点、推动更严谨的思考。

Each node is a structured workspace. You write, the AI questions. You refine, the AI pushes further. The output is a chain of thinking you can trace back and export.

每个节点都是一个结构化工作区：你写，AI 追问；你完善，AI 继续挑战。最终产出是一条可追溯、可导出的完整思考链。

---

## Who is it for? · 适合哪些人？

| Role · 角色 | How it helps · 怎么用 |
|---|---|
| **Product managers · 产品经理** | Turn vague requirements into structured, defensible specs / 把模糊需求变成有据可查的产品规格 |
| **Designers · 设计师** | Stress-test problem framing before jumping to solutions / 在跳到方案之前先把问题定义压力测试一遍 |
| **Founders · 创业者** | Validate assumptions before building / 动手之前先验证假设 |
| **Researchers · 研究者** | Systematically map stakeholders, scenarios, and alternatives / 系统化地梳理干系人、情景与替代方案 |
| **Teams · 团队** | A shared thinking record anyone can pick up mid-stream / 可随时接手的共享思考记录 |

**Not for:** pure content generation, coding assistance, or quick Q&A. This tool rewards slow, deliberate thinking.

**不适合：** 纯内容生成、编程辅助或快问快答。这个工具奖励的是缓慢而刻意的思考。

---

## The 9 Nodes · 九节点

```
Brief → Users & Jobs → Stakeholders → Alternatives
  → Scenarios → Feature List → Creative Leap → Final Features → Export
```

| # | Node · 节点 | Purpose · 目的 |
|---|---|---|
| 01 | Brief | Extract structure from raw input · 从原始输入中抽取结构 |
| 02 | Users & Jobs | Map who needs what, and why · 梳理谁需要什么、为什么 |
| 03 | Stakeholders | Surface hidden interests and tensions · 暴露隐藏的利益与张力 |
| 04 | Alternatives | What already exists; what you're really up against · 现有方案；你真正面对的竞争 |
| 05 | Scenarios | Concrete use moments — including pain points · 具体使用时刻，包括痛点 |
| 06 | Feature List | Draft features grounded in scenarios · 基于情景的功能草稿 |
| 07 | Creative Leap | First-principles reframe · 第一性原理重构 |
| 08 | Final Features | Validated, prioritized feature set · 经验证、有优先级的功能集 |
| 09 | Export | Full thinking chain as a shareable document · 完整思考链导出为可分享文档 |

---

## Model Recommendations · 模型选择建议

Thinking Desk routes different AI tasks to different models. Here is what works well:

思考工作台对不同任务路由不同模型，以下是推荐配置：

### Recommended setup · 推荐配置

```env
# Main reasoning tasks — Claude is the best choice for structured thinking
# 主推理任务 —— Claude 是结构化思考的最佳选择
AI_MODEL_DEFAULT=claude:claude-sonnet-4-5
AI_MODEL_BRIEF_EXTRACT=claude:claude-sonnet-4-5
AI_MODEL_USERS_JTBD=claude:claude-sonnet-4-5
AI_MODEL_STAKE_MATRIX=claude:claude-sonnet-4-5
AI_MODEL_SCEN_FEED=claude:claude-sonnet-4-5
AI_MODEL_FEAT_DRAFT=claude:claude-sonnet-4-5
AI_MODEL_FEAT_THREE_Q=claude:claude-sonnet-4-5
AI_MODEL_LEAP_FIRST_PRINCIPLES=claude:claude-sonnet-4-5

# Web search task — Gemini has grounding/search built in
# 联网搜索任务 —— Gemini 内置搜索能力
AI_MODEL_ALT_SCAN=gemini:gemini-2.5-pro

# Chinese long-context / history retrieval — Zhipu excels here
# 中文长上下文 / 历史项目检索 —— 智谱在此表现突出
AI_MODEL_HISTORY_SEARCH=zhipu:glm-4-plus
```

### Why these models? · 为什么选这些模型？

**Claude (Anthropic) — default for most tasks**
Claude produces tight, structured JSON output with strong reasoning. It follows complex prompts faithfully and rarely hallucinates structured data. `claude-sonnet-4-5` balances capability and cost well; upgrade to `claude-opus-4-5` for deeper reasoning on hard problems.

**Claude（Anthropic）—— 大多数任务的默认选择**
Claude 能生成紧凑的结构化 JSON 输出，推理能力强，忠实遵循复杂提示词，结构化数据幻觉率低。`claude-sonnet-4-5` 在能力和成本之间取得良好平衡；复杂问题可升级到 `claude-opus-4-5`。

**Gemini (Google) — web search tasks only**
The `ALT_SCAN` task needs real-time competitive intelligence. Gemini's native search grounding makes it the right tool for this specific job. For all other tasks, Claude or OpenAI is preferred.

**Gemini（Google）—— 仅用于联网搜索任务**
`ALT_SCAN` 任务需要实时竞品情报。Gemini 的原生搜索接地能力让它成为这个特定任务的最佳选择。其他任务仍推荐 Claude 或 OpenAI。

**Zhipu GLM (智谱) — Chinese long-context tasks**
`HISTORY_SEARCH` retrieves and summarizes past project records in Chinese. GLM models are optimized for Chinese long-context comprehension and are cost-effective for retrieval workloads.

**智谱 GLM —— 中文长上下文任务**
`HISTORY_SEARCH` 需要检索和总结中文历史项目记录。GLM 系列模型针对中文长上下文理解进行了优化，在检索任务上性价比突出。

### OpenAI as an alternative · OpenAI 作为替代

If you only have an OpenAI key, set:
```env
AI_MODEL_DEFAULT=openai:gpt-4o
AI_MODEL_ALT_SCAN=openai:gpt-4o-search-preview
```
OpenAI works well across all tasks. The `gpt-4o-search-preview` variant handles web search for `ALT_SCAN`.

如果你只有 OpenAI 的 key，将以上配置替换为 `openai:gpt-4o` 即可。搜索任务可使用 `gpt-4o-search-preview`。

---

## Quick Start · 快速启动

### Option A: Local dev · 本地开发

Requires Node 22+ and pnpm.

```bash
git clone https://github.com/totoroo/thinking-desk.git
cd thinking-desk
cp .env.example .env
# Edit .env — add at least one API key
pnpm install
docker compose up -d db        # local Postgres
pnpm db:init                   # run schema
pnpm dev                       # http://localhost:3000
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
DATABASE_URL=postgres://desk:desk@localhost:5432/thinking_desk
# At least one of: · 至少填一个：
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
ZHIPU_API_KEY=
```

### Security (for public deployments) · 安全（公开部署时建议开启）

```env
REQUIRE_AUTH=true
REQUIRE_AUTH_TOKEN=your-secret-token   # clients send: Authorization: Bearer <token>
RATE_LIMIT_MAX=20                      # requests per window per IP
RATE_LIMIT_WINDOW_MS=60000
```

---

## Project Structure · 目录结构

```
src/
├── app/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── project/[id]/[node]/page.tsx
│   └── api/ai/                  # AI server routes
├── components/
│   ├── shell/                   # TopBar · NavRail · Copilot
│   └── nodes/                   # Per-node workspace UI
├── lib/
│   ├── ai/
│   │   ├── providers/           # claude / openai / gemini / zhipu adapters
│   │   ├── router.ts            # task → provider:model routing
│   │   ├── tasks/               # prompt + schema per AI task
│   │   └── types.ts
│   └── db/
│       ├── schema.sql
│       ├── client.ts
│       └── projects.ts
└── data/
    └── nodes.ts                 # 9-node definitions
```

---

## Adding a new AI task · 新增 AI 任务

1. Add a literal to `AiTask` in `src/lib/ai/types.ts`
2. Write prompt + Zod schema in `src/lib/ai/tasks/xxx.ts`
3. Expose a server route at `src/app/api/ai/xxx/route.ts`
4. Call it from the node component
5. Optionally pin a model: `AI_MODEL_XXX=provider:model` in `.env`

---

## Tech Stack · 技术栈

- **Next.js 15** (App Router + Turbopack) · React 19 · TypeScript 5
- **Tailwind CSS 3**
- **Postgres 16** — projects, nodes, AI exchange log, assumption ledger
- **@anthropic-ai/sdk** · OpenAI SDK · Gemini SDK · Zhipu SDK

---

## License

[AGPL-3.0](LICENSE) — free to use and modify with attribution; commercial use requires the full source to remain open under the same license.
