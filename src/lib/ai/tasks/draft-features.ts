import { dataBlock } from '../prompt';
import { runTask, type RunTaskResult, type TaskOptions } from '../run-task';
import type { ClarificationAnswer } from '../schemas/extract-brief';
import type { BriefContext, InsightDigest, PainDigest } from '../schemas/snapshots';
import type { Persona, Job } from '../schemas/analyze-users';
import type { ScenarioDraft } from '../schemas/analyze-scenarios';
import { FeatureListSchema, type FeatureList } from '../schemas/draft-features';

/**
 * 方法论 v2 §九 功能列表与优先级。
 * 消费上游产物（尤其是 §8.5 设计启发），产出完整结构化功能列表：
 *  - §9.1 金字塔结构（pillar → group → feature）
 *  - §9.2 Kano 五分类（must / performance / delight / indifferent / reverse）
 *  - §9.3 RICE 评分（R × I × C ÷ E）
 *  - §9.4 五问法（加入"做错会怎样"）
 *  - §9.5 功能卡片 = 假设（核心假设 + 验证指标 + 失败信号）
 *  - §9.6 不做什么清单 + 理由
 */

const SYSTEM_PROMPT = `你是「思考工作台」第 06 功能列表节点的 AI 副驾驶。
方法论 v2 §九 要求用上游所有节点的产出（Brief / Users / Stake / Alt / 情景启发）产出结构化功能列表。

# 核心原则
**每个功能都必须有出处**——引用 insight_ids（§8.5 设计启发）/ job_ids / persona_ids / scenario_ids。
这个节点不是让用户从零写功能，而是把前面所有分析**收口**成"可执行的假设清单"。

# ★★★ feature.name 写作硬规则（最容易犯错的地方）
**feature 是"产品能力"，不是"应用情景 / 用户故事"。**

能力（correct）：用动词+名词 / 名词组合表达的**产品可独立实现的模块**。
- ✅ "拍题识别"、"步骤级启发问答"、"错题本"、"知识点图谱"、"语音输入"、"学习进度追踪"、"同步多设备"、"断点续答"、"家长周报"
- 每个都能对应到具体的 API / UI 模块 / 技术实现
- 名字本身不带"在...时"、"帮助...完成"、"当...场景"等情景描述

情景（wrong）：描述"在什么时候给什么人做什么"的用户故事。
- ❌ "帮学生在卡题时获得启发引导"（这是设计启发，不是功能）
- ❌ "家长监督下的陪练体验"（这是情景）
- ❌ "考前夜快速检验"（这是情景）

**抽取规则**：从 §8.5 设计启发的 \`action\` 字段里提炼**产品能力**。设计启发是"在 X 下我们可以 Y"，你要把 Y 里的可复用能力提取出来作为 feature.name。
一条设计启发**可能对应多个能力功能**，也可能和其他启发**共享能力**（正常——多 insight_ids 关联一个 feature 即可）。

description 可以提"服务什么 Job/情景"，但 name 必须是能力。

# §9.1 金字塔结构
- 2-5 个 pillars（支柱层 · 每个支柱代表一类根本价值主张 · 覆盖核心 Job）
- 每个 feature 归到一个 pillar（可选 group 作为中间分组）
- 同一 pillar 下的 feature **不超过 7 个**（大脑处理上限）
- pillar 之间要真正差异化，不是"移动端 / PC 端"这种切分

# §9.2 Kano 五分类（不是三类！）
- **must**: 没有用户愤怒（登录成功、支付不丢钱）
- **performance**: 越好越满意，线性关系（搜索准确度、响应速度）
- **delight**: 没有不失望，有了惊喜（差异化来源）
- **indifferent**: 有没有无感 → **优先砍掉**，不要让它出现在 features 列表，放到 not_doing
- **reverse**: 有人喜欢有人讨厌 → 做成可控选项

每个 feature 必选一个。注意 must 是"登录"这种基础，不是"AI 陪练"这种主打。

# §9.3 RICE 评分（严格四因子）
rice.reach: 每季度受影响用户数（绝对数字，按 Brief 的 target_user 规模估）
rice.impact: **只能取 0.25 / 0.5 / 1 / 2 / 3** 五档
rice.confidence: **只能取 0.5 / 0.8 / 1.0** 三档
rice.effort: 人月（design + dev + test 加总）

rice_score = reach × impact × confidence ÷ effort —— 你自己算好放进去。

# §9.4 五问法（不是三问！方法论 v2 加了第 5 问）
每个 feature 必答：
- why_do：解决哪个具体 Job？
- why_this_way：这是当前最好的实现方式吗？有没有更便宜的？
- alternatives：有没有完全不同的解法我们没想到？
- what_if_not：不做会怎样？用户会怒吗？
- **what_if_wrong: 做错会怎样？谁受伤？**（最重要，把"失败成本"显性化）

五个回答都要具体到项目，不要套话。

# §9.5 功能卡片 = 假设
每个 feature 的三件事：
- core_hypothesis：做这个功能我们相信什么？格式 "用户会 <动作> 在 <情景> 下"
- validation_metric：上线后用什么指标判断相信对了？（使用率 / 完成率 / 留存贡献，带数字阈值）
- failure_signal：什么情况就算失败？（明确阈值，如 "首周使用率低于 15%"）

# §9.6 不做什么
- **必须有 3-6 条**
- 每条带 reason：
  - \`boundary\`（超出 Brief 边界）
  - \`ethics\`（违反道德红线或伦理有问题）
  - \`indifferent\`（Kano 无差别型）
  - \`low_rice\`（RICE 评分太低）
  - \`dependency\`（依赖未满足的前提，如用户量、牌照）
- why 写具体，不写套话

# 伦理前哨（§9.5 + §十一）
- red_line_risk: 若功能与 Brief 的 red_lines 冲突 → true
- ethics_concern: 简要说明（完整七问审查在下游 §十一 节点）

# suggested_priority
每个 pillar 下至多标 2 个为 priority（suggested_priority: true）。
应当是 RICE 分高 + 直接对应 §8.5 设计启发 + Kano 不是 indifferent 的。

# differentiation_echo
一句话重申从替代方案节点传来的差异化假设——功能列表是否回应了它？
如果没有回应就直接说"当前功能未体现差异化，需要补 X"。

# critiques 最多 6 条
- check / critique / ask 三选一

# 输出
严格 JSON，不含任何前后文、不用 Markdown 代码块。`;

function formatContext(
  brief: BriefContext,
  personas: Persona[],
  jobs: Job[],
  scenarios: ScenarioDraft[],
  insights: InsightDigest[],
  painPoints: PainDigest[],
  diffHypothesis: string | undefined,
  rawText?: string,
  answers?: ClarificationAnswer[],
): string {
  const fields = Object.entries(brief.fields)
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(' · ') : v ?? '（未定义）'}`)
    .join('\n');

  const redLineBlock =
    brief.fields.red_lines.length > 0
      ? `\n\n## ★ 道德红线（硬约束 · red_line_risk 必须标 true）\n${brief.fields.red_lines.map((r) => `- ${r}`).join('\n')}`
      : '';

  const personaBlock = personas.length
    ? personas.slice(0, 6).map((p) => `[${p.id}] ${p.name} · ${p.one_liner}`).join('\n')
    : '（无已选 persona）';

  const jobsBlock = jobs.length
    ? jobs.slice(0, 10).map((j) => `- [${j.id}] ${j.title} (R${j.reach}·I${j.impact})`).join('\n')
    : '（无已锁 Job）';

  const scenarioBlock = scenarios.length
    ? scenarios.slice(0, 5).map((s) => `[${s.id}] ${s.title} · ${s.meta}`).join('\n')
    : '（无情景）';

  const insightBlock = insights.length
    ? insights
        .map(
          (i) =>
            `- [${i.id}] ${i.insight_text}\n  动作: ${i.action}${i.job_id ? ` · Job: ${i.job_id}` : ''}${i.scenario_id ? ` · 情景: ${i.scenario_id}` : ''}`,
        )
        .join('\n')
    : '（无设计启发 · 建议先完成情景节点）';

  const painBlock = painPoints.length
    ? painPoints.map((p) => `- [${p.id}] ${p.moment} · 根因: ${p.root_cause}`).join('\n')
    : '（无痛点根因）';

  const diffBlock = diffHypothesis ? `\n\n## 差异化假设（来自 §七）\n${diffHypothesis}` : '';
  const answersBlock =
    answers && answers.length > 0
      ? `\n\n## Brief 澄清\n${answers
          .map((a) => `- ${a.question}: ${Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer}`)
          .join('\n')}`
      : '';
  const rawBlock = rawText ? `\n\n## Brief 原始\n${rawText.slice(0, 400)}` : '';

  return (
    `## Brief 字段\n${fields}${redLineBlock}\n\n` +
    `## 已选 personas（${personas.length}）\n${personaBlock}\n\n` +
    `## 已锁 Jobs（${jobs.length}）\n${jobsBlock}\n\n` +
    `## 情景（已选入深度分析）\n${scenarioBlock}\n\n` +
    `## ★ §8.5 设计启发（最重要的功能候选来源）\n${insightBlock}\n\n` +
    `## 痛点根因\n${painBlock}${diffBlock}${answersBlock}${rawBlock}`
  );
}

export async function draftFeatures(args: {
  brief: BriefContext;
  rawText?: string;
  answers?: ClarificationAnswer[];
  personas: Persona[];
  lockedJobs: Job[];
  scenarios: ScenarioDraft[];
  design_insights: InsightDigest[];
  pain_points: PainDigest[];
  differentiation_hypothesis?: string;
}, opts?: TaskOptions): Promise<RunTaskResult<FeatureList>> {
  const context = formatContext(
    args.brief,
    args.personas,
    args.lockedJobs,
    args.scenarios,
    args.design_insights,
    args.pain_points,
    args.differentiation_hypothesis,
    args.rawText,
    args.answers,
  );

  const res = await runTask({
    task: 'FEAT_DRAFT',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `请基于以下上游上下文产出完整的功能列表。\n\n${dataBlock('project_context', context)}\n\n` +
          `要求：\n` +
          `1. **feature.name 必须是产品能力名词**（例"拍题识别"、"错题本"、"语音输入"），不是情景描述。\n` +
          `   从 §8.5 设计启发的 action 字段提炼能力，一条 insight 可能对应多个能力，多个 insight 也可共享一个能力。\n` +
          `2. 每个 feature 必须追溯到至少一个 insight_id / job_id\n` +
          `3. Kano 必选五类之一；indifferent 的不要进 features，放 not_doing\n` +
          `4. RICE 四因子严格取值 · rice_score 自己算好\n` +
          `5. 五问法五个回答都要具体、不套话\n` +
          `6. 功能卡片三件（假设/指标/信号）必填\n` +
          `7. not_doing 至少 3-6 条\n` +
          `8. 如果功能触及 red_lines，red_line_risk 必须标 true`,
      },
    ],
    schema: FeatureListSchema,
    maxTokens: 16000,
    temperature: 0.35,
    options: opts,
  });

  // Defensive: re-compute rice_score client-side in case model mis-arithmetic
  const features = res.data.features.map((f) => {
    const computed = (f.rice.reach * f.rice.impact * f.rice.confidence) / Math.max(f.rice.effort, 0.1);
    return { ...f, rice_score: Math.round(computed * 10) / 10 };
  });

  return { ...res, data: { ...res.data, features } };
}
