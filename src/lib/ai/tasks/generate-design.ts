import { dataBlock } from '../prompt';
import { runTask, type RunTaskResult, type TaskOptions } from '../run-task';
import type { BriefContext, FeatureDigest } from '../schemas/snapshots';
import type { Pillar } from '../schemas/draft-features';
import { DesignProposalSchema, type DesignProposal } from '../schemas/generate-design';

/**
 * 设计案生成 · NODE 08
 * 输入：跃迁后的最终功能列表 + Brief + 选中场景
 * 输出：完整设计文档（不是功能罗列） —— 信息架构、关键用户流、核心交互、数据模型、技术骨架、里程碑
 */

const SYSTEM_PROMPT = `你是「思考工作台」第 08 设计案节点的 AI 副驾驶。

# 你的任务
把跃迁后的功能列表 + Brief + 场景 → 一份**完整可执行的设计案**。
注意：不是功能罗列，是**真正意义上的产品设计文档**——读完它，工程师能开始写代码、设计师能开始画图。

# 输出结构
1. **title** — 产品/项目名（如 Brief 已定就用 Brief 的）
2. **one_liner** — 一句话产品定位
3. **vision** — 一段话愿景，回答"成功之后世界是什么样"
4. **design_principles** — 4-7 条设计原则（决策标尺，例如"始终偏向用户控制" / "默认零配置"）
5. **information_architecture** — 信息架构。2-5 段，每段一个 section（导航骨架 / 核心对象 / 状态切换等）
6. **modules** — 模块拆分。把功能按职责聚类成 3-7 个模块，每个模块说明 responsibility + 关联的 feature_ids + 主要屏幕 + 依赖
7. **user_flows** — 关键用户流 1-4 条。每条 flow 是分步骤剧本（actor / action / system_response），写到能直接画 wireframe 的颗粒度
8. **key_interactions** — 关键交互模式 2-4 段（核心手势、命令面板、AI 介入点等），每段写清楚为何这样设计
9. **data_model** — 数据模型。3-8 个核心实体，每个实体列出关键字段（name + type + note）
10. **tech_skeleton** — 技术骨架。前端框架、后端策略、数据存储、AI 调用层、第三方依赖。一段一类。
11. **metrics** — 5-10 条衡量指标，每条 name + definition + target
12. **risks** — 已知风险 + 缓解策略
13. **milestones** — 里程碑。phase / goal / deliverables / duration 时间用周/月即可
14. **open_questions** — 还没决定的问题，留给后续讨论

# 风格要求
- 写成"已经决定了"的口吻，不要"建议 / 可以考虑"。设计案就是要拍板。
- 每段都要有内容，不要空 section。
- 模块的 feature_ids 必须从输入 features 中真实引用（用功能 id）。
- 数据模型要给出能直接建表的字段。
- 严格 JSON，不含前后文，不用 Markdown 代码块。`;

function formatContext(args: {
  brief: BriefContext;
  features: FeatureDigest[];
  pillars: Pillar[];
}): string {
  const briefFields = Object.entries(args.brief.fields)
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(' · ') : v ?? '（未定义）'}`)
    .join('\n');
  const pillarBlock = args.pillars.map((p) => `- [${p.id}] ${p.name} · ${p.description}`).join('\n');
  const featureBlock = args.features
    .map(
      (f) =>
        `### [${f.id}] ${f.name}  · pillar=${f.pillar} · Kano=${f.kano} · RICE=${f.rice_score}\n` +
        `  ${f.description}\n` +
        `  核心假设：${f.core_hypothesis}\n` +
        `  验证指标：${f.validation_metric}`,
    )
    .join('\n\n');
  return (
    `## Brief 字段\n${briefFields}\n\n` +
    `## 支柱（Pillars）\n${pillarBlock}\n\n` +
    `## 最终功能列表（${args.features.length} 条 · 已应用跃迁）\n${featureBlock}`
  );
}

export async function generateDesignProposal(args: {
  brief: BriefContext;
  features: FeatureDigest[];
  pillars: Pillar[];
}, opts?: TaskOptions): Promise<RunTaskResult<DesignProposal>> {
  const ctx = formatContext(args);
  return runTask({
    task: 'DESIGN_PROPOSAL',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `请基于以下材料产出一份完整的设计案。\n\n${dataBlock('project_context', ctx)}\n\n` +
          `要求：模块的 feature_ids 必须用真实 id；用户流要写到能画 wireframe 的颗粒度；数据模型要能直接建表。`,
      },
    ],
    schema: DesignProposalSchema,
    maxTokens: 16000,
    temperature: 0.4,
    options: opts,
  });
}
