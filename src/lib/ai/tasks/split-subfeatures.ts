import { dataBlock } from '../prompt';
import { feedbackBlock } from '../feedback-prompt';
import type { RegenerationFeedback } from '../../model/feedback';
import { runTask, type RunTaskResult, type TaskOptions } from '../run-task';
import type { DesignSnapshot } from '../schemas/snapshots';
import { SubfeatureBreakdownSchema, type SubfeatureBreakdown } from '../schemas/split-subfeatures';

/**
 * 子功能拆分 · NODE 09
 * 输入：设计案（modules + features）
 * 输出：每个 feature 拆成 2-6 条可执行子任务（前端 / 后端 / 数据 / 测试 标签 + 工作量估计）
 */

const SYSTEM_PROMPT = `你是「思考工作台」第 09 子功能拆分节点的 AI 副驾驶。

# 你的任务
把设计案里的每个 feature → 拆成 2-6 条可立刻分配给工程师 / 设计师执行的子任务。
不是再次描述功能，是落到"今天就能开 ticket"的颗粒度。

# 子任务字段
- id: 简短稳定 id（feat-xxx-1 风格）
- title: 短动名词标题（"实现 XXX 接口" / "画 YYY 屏幕" / "建 ZZZ 表"）
- description: 1-2 句具体做什么
- layer: frontend / backend / data / ai / design / test / devops / mixed
- estimate: 工作量（0.5d / 2d / 1w）—— 用半天/天/周
- acceptance_criteria: 1-3 条验收标准（"跑通 X 流程" / "覆盖率 ≥ 80%"）
- dependencies: 其它子任务 id（只能引用同一次拆分内的）

# 整体字段
- splits: 每个 feature 一组
- summary: 一段话整体结论（数量 / 难点 / 建议节奏）
- total_subfeatures: 所有子任务总数
- critical_path: 关键路径上的子任务 id（1-8 个）

# 风格
- 动词开头，不要"实现一个支持..."这种描述句
- estimate 偏保守，宁多估 20%
- 子任务必须可独立完成、可验收
- 严格 JSON 输出`;

function formatContext(design: DesignSnapshot): string {
  const moduleBlock = design.modules
    .map((m) => `- [${m.id}] ${m.name} → features=[${m.feature_ids.join(', ')}]`)
    .join('\n');
  const featureBlock = design.modules
    .flatMap((m) =>
      m.feature_ids.map((fid) => `- ${fid} (module=${m.id})`),
    )
    .join('\n');
  const flowBlock = design.user_flows
    .map((f) => `- ${f.name}: ${f.goal}`)
    .join('\n');
  return (
    `## 设计案标题\n${design.title}\n\n` +
    `## 一句话\n${design.one_liner}\n\n` +
    `## 模块\n${moduleBlock}\n\n` +
    `## 待拆功能（来自模块）\n${featureBlock}\n\n` +
    `## 关键用户流\n${flowBlock}\n\n` +
    `## 数据模型\n${design.data_model.map((d) => `- ${d.name}`).join('\n')}`
  );
}

export async function splitSubfeatures(args: {
  design: DesignSnapshot;
  feedback?: RegenerationFeedback;
}, opts?: TaskOptions): Promise<RunTaskResult<SubfeatureBreakdown>> {
  const ctx = formatContext(args.design);
  return runTask({
    task: 'SPLIT_SUBFEATURES',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `请把以下设计案里的功能拆成可执行子任务：\n\n${dataBlock('design', ctx)}\n\n每个 feature 至少 2 条 subfeature，最多 6 条。` +
          feedbackBlock(args.feedback),
      },
    ],
    schema: SubfeatureBreakdownSchema,
    maxTokens: 16000,
    temperature: 0.3,
    options: opts,
  });
}
