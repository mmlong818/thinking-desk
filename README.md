# 思考工作台 · Thinking Desk

AI 陪伴下的结构化设计思考工作台，实现文档 `AI辅助设计工具_产品设计方案.md` 中定义的九节点方法论。

## 架构

- **Next.js 15 App Router** · React 19 · TypeScript · Tailwind
- **Postgres 16** 持久化项目 / 节点 / AI 对话日志 / 假设账本
- **AI 抽象层**（`src/lib/ai/`）支持三类 Provider，按任务路由：
  - `claude` —— 结构化抽取、批判追问（默认主力）
  - `gemini` —— 需要联网搜索的任务（替代方案扫描等）
  - `zhipu` —— 中文长上下文 / 历史项目检索
- 路由通过 `AI_MODEL_<TASK>` 环境变量配置，格式 `<provider>:<model>`

## 快速启动

### 1. 本地开发（需 Node 22 + pnpm）

```bash
cp .env.example .env
# 填入至少一个 provider 的 API key
pnpm install
docker compose up -d db         # 起一个本地 Postgres
pnpm db:init                    # 初始化 schema + 种子数据
pnpm dev                        # http://localhost:3000
```

### 2. 自托管 Docker 部署

```bash
cp .env.example .env
# 填入 API keys
docker compose up -d --build
# 访问 http://<host>:3000
```

`db-data` 卷会挂载在 `db-data` 下，Postgres 首次启动会自动跑 `src/lib/db/schema.sql`。

## 九节点实现状态

| # | 节点 | 状态 | 主 AI 任务 |
|---|------|------|------------|
| 01 | Brief | ✅ 已接入真实 AI | `BRIEF_EXTRACT`（Claude 结构化抽取） |
| 02 | 用户与任务 | 🔨 placeholder | `USERS_JTBD` |
| 03 | 干系人 | 🔨 placeholder | `STAKE_MATRIX` |
| 04 | 替代方案 | 🔨 placeholder | `ALT_SCAN`（需联网 → Gemini） |
| 05 | 情景 | 🔨 placeholder | `SCEN_FEED` / `SCEN_PAIN` |
| 06 | 功能列表 | 🔨 placeholder | `FEAT_DRAFT` / `FEAT_THREE_Q` / `ETHICS_SEVEN_Q` |
| 07 | 价值主张 | 🔨 placeholder | `VALUE_PROP` |
| 08 | 风险与假设 | 🔨 placeholder | `RISK_AUDIT` |
| 09 | 导出 · 沉淀 | 🔨 placeholder | `EXPORT_DOC` / `HISTORY_SEARCH` |

"placeholder" 节点已有完整视觉稿（见 `E:\CC\code\design\index.html`），等后续会话把对应 AI 任务接进来。

## 目录

```
src/
├── app/
│   ├── layout.tsx               # 根布局
│   ├── page.tsx                 # 重定向到演示项目
│   ├── project/[id]/[node]/page.tsx
│   └── api/ai/                  # AI 相关的 server routes
├── components/
│   ├── shell/                   # TopBar · NavRail · Copilot
│   └── nodes/                   # 每个节点的工作区 UI
├── lib/
│   ├── ai/
│   │   ├── providers/           # claude / gemini / zhipu 适配器
│   │   ├── router.ts            # 任务 → provider:model 路由
│   │   ├── tasks/               # 每个 AI 任务的 prompt + schema
│   │   └── types.ts
│   └── db/
│       ├── schema.sql
│       ├── client.ts
│       └── projects.ts
└── data/
    └── nodes.ts                 # 九节点定义
```

## 新增一个 AI 任务的流程

1. 在 `src/lib/ai/types.ts` 的 `AiTask` 加一个字面量
2. 在 `src/lib/ai/tasks/xxx.ts` 写 prompt + zod schema + 对应函数
3. 在 `src/app/api/ai/xxx/route.ts` 暴露 Server Route
4. 在节点组件里调用它
5. 在 `.env` 里按需指定 `AI_MODEL_XXX=provider:model`

## 设计原型

原设计参考文件 `E:\CC\code\design\index.html`，是这个正式版本的视觉规范来源。

## License

Internal tool · MIT
