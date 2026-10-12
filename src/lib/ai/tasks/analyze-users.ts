import { dataBlock } from '../prompt';
import { runTask, type RunTaskResult, type TaskOptions } from '../run-task';
import type { ClarificationAnswer } from '../schemas/extract-brief';
import type { BriefContext } from '../schemas/snapshots';
import {
  JobsRefinementSchema,
  UsersAnalysisSchema,
  PersonaBatchSchema,
  type Persona,
  type Job,
  type JobsRefinement,
  type UsersAnalysis,
  type PersonaBatch,
} from '../schemas/analyze-users';

const SYSTEM_PROMPT = `你是「思考工作台」第 02 节点"用户与任务 (JTBD)"的 AI 副驾驶。

# 任务
基于上一节点「Brief」的产出，帮用户完成：
1. 穷举 **3 个差异化的用户画像**（personas）——覆盖不同侧写与使用动机。
   - 不是"同一个人的微变种"，要真正不同（年龄段 / 付费方 vs 使用方 / 心态类型 等）
   - 首个 role="primary"，其余 role="candidate"；用户之后可以自己切换
2. 按 JTBD 方法论列出三类 Job：
   - functional（功能性 Job - 客观要完成的事）
   - emotional（情感性 Job - 主观感受）
   - social（社交性 Job - 他人眼里的"我"）
3. 为每个 Job 估算 Reach (1-10 · 多少比例用户受此影响) × Impact (1-3 · 影响强度)
4. 标注来源（source）——指向 Brief 的哪个字段或情景
5. suggested_priority 标记：每类 Job 里最多 1 个建议锁定为优先（情感性 Job 最容易被漏但最影响留存）
6. persona_ids：每个 Job 必须标注"主要由哪些 persona 感受到"，用 persona 的 id 数组。
   - 至少 1 个 id，上限所有 personas
   - 如果这个 Job 所有 persona 都有，全部写进去
   - 如果只有 primary persona 有（比如社交性 Job 常常如此），只写那一个

# 写作规范
- 角色（name）要具体到人，带真实感（例："小米 · 初二女生 · 13 岁"），不是"目标用户 A"
- one_liner 是 1-2 句概述定位，例："北京海淀重点初中 · 成绩中上"
- meta 是标签式元信息，例："付费方 · 中产家庭 · 决策者"
- story 用 2-3 句讲她的日常，有场景、有矛盾
- pain 是"最烦的一刻"式的一句话
- 3 个 persona 必须**真正互补**：不要三个都是"焦虑型学霸"。至少覆盖两类对立维度。
- Job title 动宾结构，例如"作业不会做时立刻得到可用引导"——不要写"作业辅导需求"
- source 具体到 Brief 的哪条原文或字段，例如"Brief·scenario：家中做作业时"

# critiques 最多 5 条
可选 kind：check / critique / ask

# 输出
严格 JSON，不含任何前后文、不用 Markdown 代码块。`;

const REFINE_JOBS_PROMPT = `你是「思考工作台」第 02 节点"用户与任务 (JTBD)"的 AI 副驾驶。
用户已经从画像库里选定了一批 persona 作为产品聚焦对象。现在要你**基于这批 persona 重新整理 Jobs 清单**。

# 输入
- Brief 上下文（问题 / 用户 / 场景 / 价值主张 / 边界等）
- 已选定 persona 列表（每个有 name, one_liner, meta, story, pain）
- 当前 Jobs 清单（你可能刚产出的初稿，或是上一轮的结果）
- 用户手动锁定的 Job id 列表 —— 这是用户的**显式决定**，绝对优先

# 硬性规则（必须遵守，不允许妥协）
1. **保留用户已锁定的 Job**：凡是出现在"用户手动锁定"列表里的 Job id，**必须原封不动**出现在你的输出里
   （id / title / source 不允许改动；reach、impact 可以根据新选的 persona 微调；suggested_priority 强制设为 true）。
   这是用户自己做出的判断，你的任务是尊重它，不是重新评估它。
2. 如果用户锁定的 Job 正好分类错了（比如情感性被归为功能性），你可以在对应的三类里正确放置，但不允许删除或改名。

# 其他任务
3. **删除未被锁定、且不再成立的 Job**：只服务未选 persona 的 Job，如果选中的 persona 不会经历它，删除。
4. **新增漏掉的 Job**：通过仔细审视每个选中 persona 的 story + pain，找出 **当前清单里没有覆盖** 的 Job。这是你最大的价值——用户选择多样化 persona 就是要暴露盲点。
5. **调整 Reach × Impact**：基于"这个 Job 被多少个选中 persona 感受到"重新估分（用户锁定的 Job 也允许微调）。
6. **给每个 Job 打 persona_ids**：列出哪些选中 persona 会经历这个 Job。
7. **保留结构**：三类 (functional/emotional/social) 都要有至少 1 条。
8. **priority_summary**：一句话总结"基于这批 persona + 用户已锁定的优先项，产品最该聚焦什么"。
9. **critiques 最多 3 条**：如果你发现用户的 persona 选择或 Job 优先级组合有盲点，用 critique 或 ask 提示——但不要否定用户决定。

# 写作规范
- Job title 动宾结构（例"卡住难题时获得启发式引导而非直接答案"）
- source 指向 Brief 或某个 persona 的具体片段（例"persona p2·pain: 想辅导但能力不够"）
- 新增的 Job 不要重复 title；复用 id 即可保持状态连续

# 输出
严格 JSON：{ jobs: { functional, emotional, social }, priority_summary, critiques }
不含任何前后文、不用 Markdown 代码块。`;

const ADD_PERSONAS_PROMPT = `你是「思考工作台」第 02 节点的 AI 副驾驶。
用户已经从上一轮生成里锁定了一些满意的 persona，现在要你**再补 3 个全新的、不同维度的 persona**。

# 硬性要求
- 必须是全新的画像，**绝不能**与已有列表任何一个重复或仅做微调
- 在锁定角色之外继续探索：如果锁定全是"焦虑型家长"，请补非焦虑型 / 不同年龄 / 不同地域 / 不同动机的人
- 3 个新 persona 内部也要**互相差异化**
- role 都填 "candidate"（primary 已在上一轮锁定）
- id 要用新字符串，避免与 existing 冲突

# 写作规范
与初始分析一致：name 带真实感、one_liner 1-2 句定位、meta 标签、story 2-3 句场景 + 矛盾、pain 是"最烦的一刻"。

# 输出
严格 JSON：{"personas": [ ... 3 个 ...]}，不含任何前后文。`;

interface BriefArgs {
  brief: BriefContext;
  rawText?: string;
  answers?: ClarificationAnswer[];
}

function formatBriefContext(brief: BriefContext, rawText?: string, answers?: ClarificationAnswer[]): string {
  const fields = Object.entries(brief.fields)
    .map(([k, v]) => {
      const val = Array.isArray(v) ? v.join(' · ') : v ?? '（未定义）';
      return `- ${k}: ${val}`;
    })
    .join('\n');
  const hl = brief.highlights
    .map((h) => `  [${h.kind}] ${h.text}`)
    .join('\n');
  const answersBlock =
    answers && answers.length > 0
      ? `\n\n## 用户在澄清问卷里的选择\n${answers
          .map((a) => `- ${a.question}：${Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer}`)
          .join('\n')}`
      : '';
  const rawBlock = rawText ? `\n\n## Brief 原始文字\n${rawText}` : '';
  return `## Brief 结构化字段\n${fields}\n\n## Brief 高亮\n${hl}${answersBlock}${rawBlock}`;
}

export async function analyzeUsers(args: BriefArgs, opts?: TaskOptions): Promise<RunTaskResult<UsersAnalysis>> {
  const context = formatBriefContext(args.brief, args.rawText, args.answers);
  return runTask({
    task: 'USERS_JTBD',
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: `请基于以下 Brief 完成用户与 Job 分析。\n\n${dataBlock('project_context', context)}` }],
    schema: UsersAnalysisSchema,
    maxTokens: 10000,
    temperature: 0.4,
    options: opts,
  });
}

function formatExistingPersonas(existing: Persona[], lockedIds: string[]): string {
  const locked = new Set(lockedIds);
  const lines = existing.map((p) => {
    const mark = locked.has(p.id) ? '🔒' : '  ';
    return `${mark} [${p.id}] ${p.name} · ${p.one_liner}\n     meta: ${p.meta}\n     pain: ${p.pain}`;
  });
  return lines.join('\n\n');
}

export interface RefineJobsArgs extends BriefArgs {
  selectedPersonas: Persona[];
  existingJobs: { functional: Job[]; emotional: Job[]; social: Job[] };
  /** Job ids the user has manually locked as "priority" — AI must preserve these. */
  userLockedJobIds: string[];
}

function refineJobsMessage(args: RefineJobsArgs): string {
  const context = formatBriefContext(args.brief, args.rawText, args.answers);
  const personaBlock = args.selectedPersonas
    .map(
      (p) =>
        `[${p.id}] ${p.name} · ${p.one_liner}\n  meta: ${p.meta}\n  story: ${p.story}\n  pain: ${p.pain}`,
    )
    .join('\n\n');
  const jobsBlock = JSON.stringify(args.existingJobs, null, 2);

  // Build a human-readable index of locked jobs so the model can cross-check by id + title.
  const allJobs = [
    ...args.existingJobs.functional,
    ...args.existingJobs.emotional,
    ...args.existingJobs.social,
  ];
  const lockedJobs = allJobs.filter((j) => args.userLockedJobIds.includes(j.id));
  const lockedBlock =
    lockedJobs.length === 0
      ? '（用户尚未手动锁定任何 Job · 你可以自由调整优先级）'
      : lockedJobs
          .map((j) => `- 🔒 [${j.id}] ${j.title}  (当前 R${j.reach}·I${j.impact})`)
          .join('\n');

  return (
    `## Brief 上下文\n${dataBlock('project_context', context)}\n\n` +
    `## 已选定 personas（共 ${args.selectedPersonas.length} 个）\n${dataBlock('selected_personas', personaBlock)}\n\n` +
    `## 当前 Jobs 清单\n${dataBlock('current_jobs', jobsBlock)}\n\n` +
    `## 🔒 用户已手动锁定的 Job（必须保留 · 不允许改动 id/title/source · suggested_priority 强制 true）\n${dataBlock('locked_jobs', lockedBlock)}\n\n` +
    `请基于以上信息重新整理 Jobs。特别注意：\n` +
    `1. 上面 🔒 列表里的 Job 必须原封不动出现在输出里；\n` +
    `2. 通读每个 persona 的 pain / story，找出**当前清单没覆盖的 Job**；\n` +
    `3. 新增的 Job 要与锁定项互补、不重复。`
  );
}

/** Re-asserts the user's priority locks in case the model drops the flag on a preserved job. */
function reassertLocks(refined: JobsRefinement, lockedIds: string[]): JobsRefinement {
  const locked = new Set(lockedIds);
  const mark = (jobs: Job[]) => jobs.map((j) => (locked.has(j.id) ? { ...j, suggested_priority: true } : j));
  return {
    ...refined,
    jobs: { functional: mark(refined.jobs.functional), emotional: mark(refined.jobs.emotional), social: mark(refined.jobs.social) },
  };
}

export async function refineJobs(args: RefineJobsArgs, opts?: TaskOptions): Promise<RunTaskResult<JobsRefinement>> {
  const res = await runTask({
    task: 'USERS_JTBD',
    system: REFINE_JOBS_PROMPT,
    messages: [{ role: 'user', content: refineJobsMessage(args) }],
    schema: JobsRefinementSchema,
    maxTokens: 10000,
    temperature: 0.3,
    options: opts,
  });
  return { ...res, data: reassertLocks(res.data, args.userLockedJobIds) };
}

export async function generateMorePersonas(
  args: BriefArgs & { existing: Persona[]; lockedIds: string[] },
  opts?: TaskOptions,
): Promise<RunTaskResult<PersonaBatch>> {
  const context = formatBriefContext(args.brief, args.rawText, args.answers);
  const existingBlock = formatExistingPersonas(args.existing, args.lockedIds);
  return runTask({
    task: 'USERS_JTBD',
    system: ADD_PERSONAS_PROMPT,
    messages: [
      {
        role: 'user',
        content:
          `## Brief 上下文\n${dataBlock('project_context', context)}\n\n` +
          `## 已有 persona（🔒 = 用户已锁定）\n${dataBlock('existing_personas', existingBlock)}\n\n` +
          `请生成 3 个全新的、与上述清单明显不同的 persona。`,
      },
    ],
    schema: PersonaBatchSchema,
    maxTokens: 6000,
    temperature: 0.7,
    options: opts,
  });
}
