import { dataBlock } from '../prompt';
import { feedbackBlock } from '../feedback-prompt';
import type { RegenerationFeedback } from '../../model/feedback';
import { runTask, type RunTaskResult, type TaskOptions } from '../run-task';
import type { ClarificationAnswer } from '../schemas/extract-brief';
import type { BriefContext } from '../schemas/snapshots';
import type { Persona, Job } from '../schemas/analyze-users';
import { stancePromptFragment } from '../stance-prompt';
import { AlternativesAnalysisSchema, type AlternativesAnalysis } from '../schemas/analyze-alternatives';

/**
 * 方法论 v2 §7 替代方案与战略分析。
 * 关键：三类替代（直接/间接/非消费）全覆盖 · 对重点替代做 §7.2 三问 ·
 * 产出"差异化假设"（一句话说清凭什么赢）。
 */

const SYSTEM_PROMPT = `你是「思考工作台」第 04 节点"替代方案与战略分析"的 AI 副驾驶。

# 方法论 v2 §7 的三条硬性要求

## 1. 三类替代必须全覆盖（§7.1）
- **direct（直接替代）**：同品类、同目标用户。是"表面对手"。
- **indirect（间接替代）**：不同品类但完成相同 Job。例：外卖的间接替代是预制菜、方便面。
- **non_consumption（非消费替代）**：用户干脆不解决这个问题、或用原始方式凑合。
  **★ 这是最关键的一类**，大部分产品死于用户"懒得用 / 懒得换"。
  示例：记账应用的真正对手是"用户懒得记账"；Netflix 的对手是"用户睡觉"。

每类至少 2 条，总数 6-12 条。

## 2. §7.2 战略三问（对 3-5 个重点替代做深度画像）
每个 strategic_profiles 条目必须回答：
- **promise（承诺）**：用不超过 15 字说清它的价值主张。
  例："一拍就知道答案"（作业帮）、"省时的方便面"、"不花钱的免费替代"
- **revenue_model（赢利模式）**：它靠什么赚钱？这决定了它**必然会做什么、必然不会做什么**。
  例：靠广告赚钱的内容平台不可能真的帮用户节省时间；靠交易抽成的平台不可能帮用户绕过平台
- **moat（护城河）**：它为什么难被替代？规模 / 网络效应 / 转换成本 / 品牌 / 数据 / 监管许可 / 独家资源
- **moat_strength**：strong（几乎不可逾越） / medium（可逾越但难） / weak（容易被撼动）

## 3. §7.3 功能与体验拆解（对 2-3 个最直接的竞品做）
feature_breakdowns 每条覆盖：
- **menu_structure**：菜单结构有哪些大类
- **core_flows**：核心流程跑一遍是哪几步
- **key_interactions**：关键交互动作（长按、滑动、摇一摇等特色操作）
- **headline_features**：官网 / 帮助文档强调的亮点

非消费替代不需要做功能拆解（它没功能）。

# 写作规范

- name：**具体到可识别的产品或行为**。不要写"某 AI 搜题 App"，写"作业帮"、"猿辅导小状元"、"作业交给 ChatGPT"。如果是非消费替代，名字就是行为本身，如"放弃问问题、自己瞎做"、"抄同学作业"。
- description：这个替代是什么 / 用户如何使用它
- why_users_use：它满足了用户的哪个 Job（对齐我们的 Jobs 清单）
- sources：**如果你用了联网搜索**，把真实搜到的 URL 放进来；没搜到就空数组。绝不编造 URL。

# 差异化假设
最后给 differentiation_hypothesis —— 一句话说清"我们凭什么赢"。
必须基于以上分析推出，**不能是空口号**。
格式参考："我们凭 [某个具体优势 / 结构] 解决 [某个对手没解决的 Job]，用户会因为 [某个情感或功能理由] 选我们。"
同时给 differentiation_stance —— 你对这条假设本身的判断（见下方 stance 规则）。

# key_threats 前 3
列出你分析后认为对我们威胁最大的 3 条。可能是某个具体对手，也可能是"非消费"的总威胁。

# critiques 最多 5 条
- check：中性提醒（例"非消费替代只列了 2 条，偏少"）
- critique：有力挑战（例"你的差异化假设里'更懂学生'这种话经不起三问"）
- ask：追问用户决策（例"要不要把作业帮家长端作为直接替代单独列出？"）

# 输出
严格 JSON，不含任何前后文、不用 Markdown 代码块。

${stancePromptFragment(
  '差异化假设（differentiation_stance，只有这一条）',
  '对差异化假设而言：recommend = 它能从上面的替代分析里推出来，点名了对手没解决的具体 Job，经得起"凭什么赢"的追问；neutral = 方向合理，但能不能成立取决于团队的资源 / 取舍，或联网搜到的证据不足以判断；caution = 像空口号、依赖没验证的假设、绕开了最强的替代（尤其是非消费替代），或与 key_threats 里的威胁自相矛盾。',
)}`;

function formatContext(
  brief: BriefContext,
  personas: Persona[],
  jobs: Job[],
  rawText?: string,
  answers?: ClarificationAnswer[],
): string {
  const fields = Object.entries(brief.fields)
    .map(([k, v]) => {
      const val = Array.isArray(v) ? v.join(' · ') : v ?? '（未定义）';
      return `- ${k}: ${val}`;
    })
    .join('\n');
  const personaBlock = personas.length
    ? personas
        .map(
          (p) => `[${p.id}] ${p.name} · ${p.one_liner}\n  pain: ${p.pain}`,
        )
        .join('\n\n')
    : '（尚无锁定 persona · 请从 Brief 推断典型用户）';
  const jobsBlock = jobs.length
    ? jobs.map((j) => `- [${j.id}] ${j.title}`).join('\n')
    : '（尚无锁定 Job · 请从 Brief 推断典型任务）';
  const answersBlock =
    answers && answers.length > 0
      ? `\n\n## Brief 澄清回答\n${answers
          .map((a) => `- ${a.question}：${Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer}`)
          .join('\n')}`
      : '';
  const rawBlock = rawText ? `\n\n## Brief 原始文字\n${rawText.slice(0, 600)}` : '';
  return (
    `## Brief 结构化字段\n${fields}\n\n` +
    `## 已锁定 personas（${personas.length}）\n${personaBlock}\n\n` +
    `## 已锁定 Jobs（${jobs.length}）\n${jobsBlock}` +
    `${answersBlock}${rawBlock}`
  );
}

export async function analyzeAlternatives(args: {
  brief: BriefContext;
  rawText?: string;
  answers?: ClarificationAnswer[];
  personas: Persona[];
  lockedJobs: Job[];
  feedback?: RegenerationFeedback;
}, opts?: TaskOptions): Promise<RunTaskResult<AlternativesAnalysis>> {
  const context = formatContext(
    args.brief,
    args.personas,
    args.lockedJobs,
    args.rawText,
    args.answers,
  );
  return runTask({
    task: 'ALT_SCAN',
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `请基于以下上下文完成替代方案与战略分析。\n\n${dataBlock('project_context', context)}\n\n` +
          `**请使用联网搜索** —— 查找真实的直接/间接替代产品（官网、价位、用户量、评价），` +
          `把搜到的 URL 填入对应 alternative.sources。非消费替代不需要搜索。` +
          feedbackBlock(args.feedback),
      },
    ],
    schema: AlternativesAnalysisSchema,
    webSearch: true, // ← 触发 provider 的联网搜索能力
    maxTokens: 12000,
    temperature: 0.4,
    options: opts,
  });
}
