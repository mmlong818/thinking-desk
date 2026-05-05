import { z } from 'zod';
import { runAi } from '../router';
import type { BriefExtraction, ClarificationAnswer } from './extract-brief';
import type { Persona, Job } from './analyze-users';

export const StakeholderSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.string(),
  power: z.enum(['high', 'low']),
  interest: z.enum(['high', 'low']),
  note: z.string(),
  source: z.string(),
  /** Baseline stakeholders (sponsor, maker, business owner, compliance) are
   *  required — they stay selected and cannot be removed by the user. */
  required: z.boolean().default(false),
  category: z.enum([
    'sponsor',
    'maker',
    'business',
    'user',
    'compliance',
    'partner',
    'competitor',
    'other',
  ]),
  engagement_hint: z.string().optional().default(''),
});
export type Stakeholder = z.infer<typeof StakeholderSchema>;

export const EngagementPlanSchema = z.object({
  manage: z.string(),
  satisfy: z.string(),
  inform: z.string(),
  monitor: z.string(),
});
export type EngagementPlan = z.infer<typeof EngagementPlanSchema>;

export const StakeholdersAnalysisSchema = z.object({
  stakeholders: z.array(StakeholderSchema).min(5).max(15),
  engagement_plan: EngagementPlanSchema,
  priority_summary: z.string(),
  critiques: z
    .array(
      z.object({
        kind: z.enum(['check', 'critique', 'ask']),
        title: z.string(),
        body: z.string(),
      }),
    )
    .max(5),
});
export type StakeholdersAnalysis = z.infer<typeof StakeholdersAnalysisSchema>;

const JSON_SCHEMA = {
  type: 'object',
  required: ['stakeholders', 'engagement_plan', 'priority_summary', 'critiques'],
  properties: {
    stakeholders: {
      type: 'array',
      minItems: 5,
      maxItems: 15,
      items: {
        type: 'object',
        required: [
          'id',
          'name',
          'role',
          'power',
          'interest',
          'note',
          'source',
          'required',
          'category',
          'engagement_hint',
        ],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          role: { type: 'string' },
          power: { type: 'string', enum: ['high', 'low'] },
          interest: { type: 'string', enum: ['high', 'low'] },
          note: { type: 'string' },
          source: { type: 'string' },
          required: { type: 'boolean' },
          category: {
            type: 'string',
            enum: [
              'sponsor',
              'maker',
              'business',
              'user',
              'compliance',
              'partner',
              'competitor',
              'other',
            ],
          },
          engagement_hint: { type: 'string' },
        },
      },
    },
    engagement_plan: {
      type: 'object',
      required: ['manage', 'satisfy', 'inform', 'monitor'],
      properties: {
        manage: { type: 'string' },
        satisfy: { type: 'string' },
        inform: { type: 'string' },
        monitor: { type: 'string' },
      },
    },
    priority_summary: { type: 'string' },
    critiques: {
      type: 'array',
      maxItems: 5,
      items: {
        type: 'object',
        required: ['kind', 'title', 'body'],
        properties: {
          kind: { type: 'string', enum: ['check', 'critique', 'ask'] },
          title: { type: 'string' },
          body: { type: 'string' },
        },
      },
    },
  },
};

const SYSTEM_PROMPT = `你是「思考工作台」第 03 节点"干系人 (Mendelow 矩阵)"的 AI 副驾驶。

# 任务
基于 Brief + 已选 persona + 已锁定 Job 的上下文，输出 8–12 个干系人，放入 Mendelow 2×2 矩阵。
- 两个维度：权力（high/low）× 关心程度（interest, high/low）
- 组合出 4 个象限：
  - manage   = high power + high interest  → 重点管理、深度共创
  - satisfy  = high power + low interest   → 保持满意、重点汇报
  - inform   = low power + high interest   → 保持告知、信息同步
  - monitor  = low power + low interest    → 最低力度、定期扫描

# ★ 基线干系人（required: true · 必须出现）
无论 Brief 是什么，以下角色都需要出现在输出里。给出**具体适合本项目的化身**，不要写"发起人 A"这种占位名：
1. **项目发起人 / 决策层**（category: sponsor）—— 拍板立项 / 最终汇报对象，通常 power=high
2. **设计/产品团队**（category: maker）—— 做这件事的人，对产出质量有直接影响；默认 power=low, interest=high
3. **使用者背后的组织 / 业务方**（category: business）—— 使用者所在的单位，为使用结果承担责任或收益。
   举例：学生用户的"学校"、企业员工用户的"部门"、消费者用户的"家庭"
4. **合规 / 法务 / 政策监管**（category: compliance）—— 任何涉及数据、未成年、金融、医疗的项目都不能跳过
5. **终端用户群体**（category: user）—— 从上游 Users 节点的 locked personas 里抽取 1-2 个代表

基线之外的 3-7 个项目专属干系人请**根据 Brief / persona / Jobs 推导**（例如：引流合作方、内容供应商、KOL、客服团队、投资人等），它们 required: false。

# 写作规范
- name：具体到可识别的人/团队名（例"李总（项目发起人）"、"海淀区教育局"、"小米的数学老师"），不要泛化
- role：一句话讲这个干系人的作用 / 身份
- note：他们**为什么重要** / 有什么**具体诉求或红线**
- source：指向 Brief 字段 / persona id / 基线角色（例"persona p1 · 学校"、"基线·合规"）
- engagement_hint：一句话说明"该怎么对待他们"（例"月度邮件 + 季度评审"、"发版前必须征询法务"）

# engagement_plan（四象限通用沟通节奏）
用四个句子总结："在本项目里，manage / satisfy / inform / monitor 这四类干系人分别该用什么节奏对待"。
要具体到频率和形式，不要写"保持联系"这种空话。

# critiques 最多 5 条
- check    —— 中性提醒（例"满意象限偏空 · 需要补充"）
- critique —— 有力挑战（例"把教育局放到 monitor 象限风险很大"）
- ask      —— 追问用户做决策（例"这个项目要不要先和合规对齐再开工？"）

# 输出
严格 JSON，不含任何前后文、不用 Markdown 代码块。`;

function formatContext(
  brief: BriefExtraction,
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
          (p) =>
            `[${p.id}] ${p.name} · ${p.one_liner}\n  meta: ${p.meta}\n  pain: ${p.pain}`,
        )
        .join('\n\n')
    : '（没有选中任何 persona · 请基于 Brief 推断基线）';
  const jobsBlock = jobs.length
    ? jobs.map((j) => `- [${j.id}] ${j.title}  (R${j.reach}·I${j.impact})`).join('\n')
    : '（没有已锁定 Job）';
  const answersBlock =
    answers && answers.length > 0
      ? `\n\n## Brief 澄清问卷\n${answers
          .map(
            (a) =>
              `- ${a.question}：${Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer}`,
          )
          .join('\n')}`
      : '';
  const rawBlock = rawText ? `\n\n## Brief 原始文字\n${rawText}` : '';
  return (
    `## Brief 结构化字段\n${fields}\n\n` +
    `## 已选定 personas（${personas.length} 个）\n${personaBlock}\n\n` +
    `## 已锁定 Jobs（${jobs.length} 个）\n${jobsBlock}` +
    `${answersBlock}${rawBlock}`
  );
}

export async function analyzeStakeholders(args: {
  brief: BriefExtraction;
  rawText?: string;
  answers?: ClarificationAnswer[];
  personas: Persona[];
  lockedJobs: Job[];
  override?: string;
}): Promise<StakeholdersAnalysis> {
  const context = formatContext(
    args.brief,
    args.personas,
    args.lockedJobs,
    args.rawText,
    args.answers,
  );
  const res = await runAi({
    task: 'STAKE_MATRIX',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `请基于以下上下文完成 Mendelow 矩阵干系人分析。\n\n${context}\n\n` +
          `请务必包含 5 类 required: true 的基线干系人（sponsor / maker / business / compliance / user），` +
          `外加 3-7 个项目专属的。`,
      },
    ],
    schema: JSON_SCHEMA,
    maxTokens: 10000,
    temperature: 0.35,
    override: args.override,
  });
  return StakeholdersAnalysisSchema.parse(res.data);
}
