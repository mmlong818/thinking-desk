import { z } from 'zod';
import { runAi } from '../router';
import type { BriefExtraction, ClarificationAnswer } from './extract-brief';
import type { Persona, Job } from './analyze-users';

/**
 * 方法论 v2 §八 情景分析。
 * 三阶段流水线：
 *  Stage 1 · exhaust  —— 7 维（时间/地点/人物/起因/过程/道具/条件）各穷举 8-12 个候选
 *  Stage 2 · combine  —— 用户勾选要素 → AI 组合出 6-8 个具体情景
 *  Stage 3 · deep     —— 用户选 3 个深入 → AI 产出：
 *                        · 情景×Job 矩阵（§8.2）
 *                        · 极值情景（§8.3）
 *                        · 敌意情景（§8.3）
 *                        · 痛点/快点连续追问"为什么"（§8.4）
 *                        · 设计启发（§8.5 固定格式）
 */

// =============================================================
// Stage 1: 7-dim exhaust
// =============================================================

export const DIMENSION_KEYS = [
  'time',
  'place',
  'people',
  'trigger',
  'process',
  'tools',
  'conditions',
] as const;
export type DimensionKey = (typeof DIMENSION_KEYS)[number];

export const DIMENSION_META: Record<DimensionKey, { label: string; hint: string }> = {
  time:       { label: '时间', hint: '清晨 / 通勤 / 午休 / 加班 / 睡前' },
  place:      { label: '地点', hint: '家里 / 办公室 / 地铁 / 咖啡馆 / 户外' },
  people:     { label: '人物', hint: '独自 / 有家人 / 有同事 / 有陌生人' },
  trigger:    { label: '起因', hint: '心理状态 / 外部事件 / 生理需要' },
  process:    { label: '过程', hint: '一步步发生了什么（v2 新增）' },
  tools:      { label: '道具', hint: '手机 / 电脑 / 纸笔 / 其他产品' },
  conditions: { label: '条件', hint: '没网 / 电量低 / 嘈杂 / 昏暗 / 时间紧迫' },
};

export const ElementSchema = z.object({
  id: z.string(),
  text: z.string(),
  /** AI 打分：这个候选对项目多相关（>Brief/Jobs 推断） */
  relevance: z.enum(['high', 'medium', 'low']).default('medium'),
});
export type ScenarioElement = z.infer<typeof ElementSchema>;

export const DimensionsResultSchema = z.object({
  dimensions: z.object({
    time:       z.array(ElementSchema).min(6).max(12),
    place:      z.array(ElementSchema).min(6).max(12),
    people:     z.array(ElementSchema).min(6).max(12),
    trigger:    z.array(ElementSchema).min(6).max(12),
    process:    z.array(ElementSchema).min(6).max(12),
    tools:      z.array(ElementSchema).min(6).max(12),
    conditions: z.array(ElementSchema).min(6).max(12),
  }),
});
export type DimensionsResult = z.infer<typeof DimensionsResultSchema>;

const DIMENSIONS_JSON_SCHEMA = {
  type: 'object',
  required: ['dimensions'],
  properties: {
    dimensions: {
      type: 'object',
      required: [...DIMENSION_KEYS],
      properties: Object.fromEntries(
        DIMENSION_KEYS.map((k) => [
          k,
          {
            type: 'array',
            minItems: 6,
            maxItems: 12,
            items: {
              type: 'object',
              required: ['id', 'text', 'relevance'],
              properties: {
                id: { type: 'string' },
                text: { type: 'string' },
                relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
              },
            },
          },
        ]),
      ),
    },
  },
};

const EXHAUST_PROMPT = `你是「思考工作台」第 05 情景节点的 AI 副驾驶。
方法论 v2 §8.1 要求穷举 7 维构成情景的要素，**先发散再收敛**。

# 任务
为 7 个维度（time / place / people / trigger / process / tools / conditions）各生成 8-12 个候选要素。

# 写作规范
- 每个要素 text **具体到场景**：
  - 好："深夜哄孩子睡后的 20 分钟独处" · "通勤地铁信号断断续续"
  - 差："晚上" · "地铁上"（太抽象）
- 穷举要**覆盖极值**：不只是"标准用户在标准环境"
  - 时间要包含：清晨 / 深夜 / 周末 / 假期 / 连续使用 8 小时 / 极短碎片
  - 地点要包含：典型场所 + 极端场所（30000 米高空、地下车库、户外）
  - 人物要包含：独自 / 有人在场 / 极端人群（老人、儿童、一只手操作）
  - 条件要包含：理想条件 + 极端（没网、电量 1%、嘈杂、疲劳）
- relevance 打分：
  - high：Brief / 已锁 Jobs 明确涉及
  - medium：领域内常见但不是核心
  - low：穷举硬要求但不太可能真的用到
- id 格式：\`<dim>_<短哈希>\`，例 \`time_morning\` / \`place_bedroom\`

# 输出
严格 JSON：\`{ dimensions: { time: [...], place: [...], ..., conditions: [...] } }\`
不含任何前后文、不用 Markdown 代码块。`;

function formatContext(
  brief: BriefExtraction,
  personas: Persona[],
  jobs: Job[],
  rawText?: string,
  answers?: ClarificationAnswer[],
): string {
  const fields = Object.entries(brief.fields)
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(' · ') : v ?? '（未定义）'}`)
    .join('\n');
  const personaBlock = personas.length
    ? personas
        .slice(0, 6)
        .map((p) => `[${p.id}] ${p.name} · ${p.one_liner}\n  pain: ${p.pain}`)
        .join('\n\n')
    : '（尚无已选 persona）';
  const jobsBlock = jobs.length
    ? jobs.slice(0, 10).map((j) => `- [${j.id}] ${j.title}`).join('\n')
    : '（尚无已锁 Job）';
  const answersBlock =
    answers && answers.length > 0
      ? `\n\n## Brief 澄清\n${answers
          .map((a) => `- ${a.question}: ${Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer}`)
          .join('\n')}`
      : '';
  const rawBlock = rawText ? `\n\n## Brief 原始\n${rawText.slice(0, 500)}` : '';
  return (
    `## Brief 字段\n${fields}\n\n` +
    `## 已选 personas\n${personaBlock}\n\n` +
    `## 已锁 Jobs\n${jobsBlock}${answersBlock}${rawBlock}`
  );
}

export async function exhaustScenarioDimensions(args: {
  brief: BriefExtraction;
  rawText?: string;
  answers?: ClarificationAnswer[];
  personas: Persona[];
  lockedJobs: Job[];
  override?: string;
}): Promise<DimensionsResult> {
  const context = formatContext(args.brief, args.personas, args.lockedJobs, args.rawText, args.answers);
  const res = await runAi({
    task: 'SCEN_FEED',
    messages: [
      { role: 'system', content: EXHAUST_PROMPT },
      {
        role: 'user',
        content: `${context}\n\n请按 7 维穷举 8-12 个候选要素。覆盖标准场景 + 极值。`,
      },
    ],
    schema: DIMENSIONS_JSON_SCHEMA,
    maxTokens: 10000,
    temperature: 0.6,
    override: args.override,
  });
  return DimensionsResultSchema.parse(res.data);
}

// =============================================================
// Stage 2: combine selected elements into scenarios
// =============================================================

export const ScenarioDraftSchema = z.object({
  id: z.string(),
  title: z.string(),
  meta: z.string(),
  narrative: z.string(),
  /** 引用的 element id 列表，用于溯源 */
  element_ids: z.array(z.string()).min(3),
  /** 这个情景服务哪些 Jobs */
  job_ids: z.array(z.string()).default([]),
  /** 隐约感受到的痛点（粗略，Stage 3 会深入） */
  pain_hint: z.string(),
});
export type ScenarioDraft = z.infer<typeof ScenarioDraftSchema>;

export const ScenarioDraftsSchema = z.object({
  scenarios: z.array(ScenarioDraftSchema).min(5).max(8),
});
export type ScenarioDrafts = z.infer<typeof ScenarioDraftsSchema>;

const COMBINE_JSON_SCHEMA = {
  type: 'object',
  required: ['scenarios'],
  properties: {
    scenarios: {
      type: 'array',
      minItems: 5,
      maxItems: 8,
      items: {
        type: 'object',
        required: ['id', 'title', 'meta', 'narrative', 'element_ids', 'job_ids', 'pain_hint'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          meta: { type: 'string' },
          narrative: { type: 'string' },
          element_ids: { type: 'array', minItems: 3, items: { type: 'string' } },
          job_ids: { type: 'array', items: { type: 'string' } },
          pain_hint: { type: 'string' },
        },
      },
    },
  },
};

const COMBINE_PROMPT = `你是「思考工作台」第 05 情景节点的 AI 副驾驶。
方法论 v2 §8.2 要求把用户勾选的要素交叉组合成**具体情景**。

# 任务
基于用户勾选的 7 维要素，组合出 **5-8 个具体情景**。每个情景应该是可以"演"出来的。

# 写作规范
- title：8-15 字，像电影一幕的标题
  - 好："深夜哄睡后的 20 分钟独处"、"考前一晚的临时抱佛脚"
  - 差："家庭场景"、"学习场景"
- meta：元信息，像 \`19:30 · 卧室 · 独自 · iPad\`（时间 · 地点 · 人物 · 道具）
- narrative：2-3 句**具身化**叙事，有场景、有动作、有矛盾
- element_ids：引用的要素 id 列表（至少 3 个维度）
- job_ids：这个情景里用户试图完成的 Job（从上游锁定 Jobs 列表匹配）
- pain_hint：一两句话先感受一下"哪里不对劲"（Stage 3 会深入挖）

# 组合策略
- 优先组合"**高频 + 高情感**"的交叉（方法论说这类最能形成忠诚）
- 覆盖至少 **3 种差异化**的情景，不要五个都是"在家独自"
- 至少 1 个情景涉及**他人在场**（家长 / 同事 / 陌生人）
- 至少 1 个情景涉及**非理想条件**（疲劳 / 嘈杂 / 时间紧）

# 输出
严格 JSON：\`{ scenarios: [ ... ] }\`
不含任何前后文、不用 Markdown 代码块。`;

export async function combineScenarios(args: {
  brief: BriefExtraction;
  rawText?: string;
  answers?: ClarificationAnswer[];
  personas: Persona[];
  lockedJobs: Job[];
  dimensions: DimensionsResult;
  selectedElementIds: string[];
  override?: string;
}): Promise<ScenarioDrafts> {
  const context = formatContext(args.brief, args.personas, args.lockedJobs, args.rawText, args.answers);
  const selectedSet = new Set(args.selectedElementIds);
  const selectedBlock = DIMENSION_KEYS.map((k) => {
    const picked = args.dimensions.dimensions[k].filter((e) => selectedSet.has(e.id));
    if (picked.length === 0) return null;
    return `### ${DIMENSION_META[k].label}\n${picked.map((e) => `- [${e.id}] ${e.text}`).join('\n')}`;
  })
    .filter(Boolean)
    .join('\n\n');

  const res = await runAi({
    task: 'SCEN_FEED',
    messages: [
      { role: 'system', content: COMBINE_PROMPT },
      {
        role: 'user',
        content:
          `${context}\n\n## 用户勾选的要素（${args.selectedElementIds.length} 个）\n${selectedBlock}\n\n` +
          `请组合出 5-8 个差异化情景。`,
      },
    ],
    schema: COMBINE_JSON_SCHEMA,
    maxTokens: 8000,
    temperature: 0.5,
    override: args.override,
  });
  return ScenarioDraftsSchema.parse(res.data);
}

// =============================================================
// Stage 3: deep analyze (matrix / extremes / hostiles / insights)
// =============================================================

export const PainPointSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  moment: z.string(),
  feeling: z.string(),
  /** §8.4 连续追问 3 层"为什么"。why_1 是第一次追问，why_3 最底层 */
  why_1: z.string(),
  why_2: z.string(),
  why_3: z.string(),
  root_cause: z.string(),
});
export type PainPoint = z.infer<typeof PainPointSchema>;

export const DelightPointSchema = z.object({
  id: z.string(),
  scenario_id: z.string(),
  moment: z.string(),
  feeling: z.string(),
  /** 用户真正被打动的深层理由 */
  root_reason: z.string(),
  /** 产品可抓住的创新机会 */
  opportunity: z.string(),
});
export type DelightPoint = z.infer<typeof DelightPointSchema>;

export const MatrixCellSchema = z.object({
  scenario_id: z.string(),
  job_id: z.string(),
  frequency: z.enum(['high', 'medium', 'low']),
  importance: z.enum(['high', 'medium', 'low']),
  /** §8.2 三种格子分类 */
  category: z.enum(['core', 'safety_net', 'fringe']),
  note: z.string(),
});
export type MatrixCell = z.infer<typeof MatrixCellSchema>;

export const ExtremeScenarioSchema = z.object({
  id: z.string(),
  dim: z.enum([...DIMENSION_KEYS]),
  pushed_to_limit: z.string(),
  description: z.string(),
  robustness_gap: z.string(),
});
export type ExtremeScenario = z.infer<typeof ExtremeScenarioSchema>;

export const HostileScenarioSchema = z.object({
  id: z.string(),
  attack: z.string(),
  vulnerable_users: z.string(),
  mitigation: z.string(),
  severity: z.enum(['high', 'medium', 'low']),
});
export type HostileScenario = z.infer<typeof HostileScenarioSchema>;

export const DesignInsightSchema = z.object({
  id: z.string(),
  /** §8.5 固定格式：在 [情景] 下，[用户] 想完成 [Job]，他的痛点是 [XX]，因此我们可以 [动作] */
  scenario_id: z.string(),
  job_id: z.string().optional(),
  pain_id: z.string().optional(),
  insight_text: z.string(),
  action: z.string(),
});
export type DesignInsight = z.infer<typeof DesignInsightSchema>;

export const ScenarioDeepAnalysisSchema = z.object({
  matrix: z.array(MatrixCellSchema),
  extremes: z.array(ExtremeScenarioSchema).min(3).max(8),
  hostiles: z.array(HostileScenarioSchema).min(2).max(6),
  pain_points: z.array(PainPointSchema).min(3),
  delight_points: z.array(DelightPointSchema),
  design_insights: z.array(DesignInsightSchema).min(3).max(10),
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
export type ScenarioDeepAnalysis = z.infer<typeof ScenarioDeepAnalysisSchema>;

const DEEP_JSON_SCHEMA = {
  type: 'object',
  required: [
    'matrix',
    'extremes',
    'hostiles',
    'pain_points',
    'delight_points',
    'design_insights',
    'critiques',
  ],
  properties: {
    matrix: {
      type: 'array',
      items: {
        type: 'object',
        required: ['scenario_id', 'job_id', 'frequency', 'importance', 'category', 'note'],
        properties: {
          scenario_id: { type: 'string' },
          job_id: { type: 'string' },
          frequency: { type: 'string', enum: ['high', 'medium', 'low'] },
          importance: { type: 'string', enum: ['high', 'medium', 'low'] },
          category: { type: 'string', enum: ['core', 'safety_net', 'fringe'] },
          note: { type: 'string' },
        },
      },
    },
    extremes: {
      type: 'array',
      minItems: 3,
      maxItems: 8,
      items: {
        type: 'object',
        required: ['id', 'dim', 'pushed_to_limit', 'description', 'robustness_gap'],
        properties: {
          id: { type: 'string' },
          dim: { type: 'string', enum: [...DIMENSION_KEYS] },
          pushed_to_limit: { type: 'string' },
          description: { type: 'string' },
          robustness_gap: { type: 'string' },
        },
      },
    },
    hostiles: {
      type: 'array',
      minItems: 2,
      maxItems: 6,
      items: {
        type: 'object',
        required: ['id', 'attack', 'vulnerable_users', 'mitigation', 'severity'],
        properties: {
          id: { type: 'string' },
          attack: { type: 'string' },
          vulnerable_users: { type: 'string' },
          mitigation: { type: 'string' },
          severity: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
    pain_points: {
      type: 'array',
      minItems: 3,
      items: {
        type: 'object',
        required: ['id', 'scenario_id', 'moment', 'feeling', 'why_1', 'why_2', 'why_3', 'root_cause'],
        properties: {
          id: { type: 'string' },
          scenario_id: { type: 'string' },
          moment: { type: 'string' },
          feeling: { type: 'string' },
          why_1: { type: 'string' },
          why_2: { type: 'string' },
          why_3: { type: 'string' },
          root_cause: { type: 'string' },
        },
      },
    },
    delight_points: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'scenario_id', 'moment', 'feeling', 'root_reason', 'opportunity'],
        properties: {
          id: { type: 'string' },
          scenario_id: { type: 'string' },
          moment: { type: 'string' },
          feeling: { type: 'string' },
          root_reason: { type: 'string' },
          opportunity: { type: 'string' },
        },
      },
    },
    design_insights: {
      type: 'array',
      minItems: 3,
      maxItems: 10,
      items: {
        type: 'object',
        required: ['id', 'scenario_id', 'insight_text', 'action'],
        properties: {
          id: { type: 'string' },
          scenario_id: { type: 'string' },
          job_id: { type: 'string' },
          pain_id: { type: 'string' },
          insight_text: { type: 'string' },
          action: { type: 'string' },
        },
      },
    },
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

const DEEP_PROMPT = `你是「思考工作台」第 05 情景节点的 AI 副驾驶。
用户已从组合情景里选了 3 个深入。你要一次产出五份产出物，覆盖 §8.2-8.5 全部方法论要求。

# 产出一 · 情景 × Job 矩阵（§8.2）
为每个"选中情景 × 已锁 Job"的交叉填一个格子：
- frequency：这个情景下这个 Job 发生的频率（high/medium/low）
- importance：情感/后果强度（high/medium/low）
- category：
  - **core**（高频 + 高重要）：产品骨干体验，必须做对
  - **safety_net**（低频 + 高风险）：不求高频表现但求零失败
  - **fringe**（其他）：边缘场景，可先不做
- note：一句话说明"为什么是这个分类"

# 产出二 · 极值情景（§8.3 第一部分）
3-6 个。**把 7 维要素之一推到极限**：
- 时间极值（凌晨 3 点、连续使用 8 小时、每周只用一次）
- 地点极值（北极圈、地下车库、30000 米高空）
- 条件极值（完全没网、电量 1%、屏幕全是指纹）
- 人物极值（80 岁老人、5 岁儿童、只会用一只手）

每条描述清楚：
- pushed_to_limit：推到了什么极限
- description：具体场景
- robustness_gap：当前方案在此极值下会怎么崩

# 产出三 · 敌意情景（§8.3 第二部分）
2-4 个。**如果有人恶意使用会怎样**：
- 刷量 / 骚扰 / 欺诈
- 利用产品伤害他人
- 自动化工具滥用系统
- 侵犯他人隐私

任何涉及 UGC / 社交 / 支付 / 数据收集的产品**都必须有**敌意情景分析。
每条包含 attack / vulnerable_users / mitigation / severity。

# 产出四 · 痛点连续追问（§8.4 最精髓）
每个选中情景**至少 1 个痛点**，用"连续追问为什么"挖到底层心理：
- moment：用户具体哪一刻
- feeling：他感觉到什么（烦、慌、无助、屈辱、愤怒）
- why_1：表层原因
- why_2：追问一层后的原因
- why_3：再追问一层到底层心理
- root_cause：最底层的心理根源

示例（方法论原话）：
- moment: 飞机晚点
- feeling: 很烦
- why_1: 错过了一个会
- why_2: 那个会议决定了他是否能升职
- why_3: 对自己职业前途失去控制感
- root_cause: 控制感缺失

快点（delight_points）可选，每个选中情景 0-2 个，结构类似。

# 产出五 · 设计启发（§8.5 固定格式）
3-8 条。每条必须用**方法论规定的句式**：
"**在 [情景] 下，[用户] 想完成 [Job]，他的痛点是 [XX]，因此我们可以 [具体的设计动作]**。"

insight_text 就放完整这句话，action 单独放"设计动作"短句方便引用。

# critiques 最多 5 条
- check：提醒（例"敌意情景只有 2 条 · K12 涉及未成年人建议加到 4 条"）
- critique：挑战（例"你选的 3 个情景都是家里 · 缺了学校场景"）
- ask：反问（例"要不要补充一个涉及家长干预的敌意情景？"）

# 输出
严格 JSON，不含任何前后文、不用 Markdown 代码块。`;

export async function deepAnalyzeScenarios(args: {
  brief: BriefExtraction;
  rawText?: string;
  answers?: ClarificationAnswer[];
  personas: Persona[];
  lockedJobs: Job[];
  scenarios: ScenarioDraft[];
  pickedScenarioIds: string[];
  override?: string;
}): Promise<ScenarioDeepAnalysis> {
  const context = formatContext(args.brief, args.personas, args.lockedJobs, args.rawText, args.answers);
  const pickedSet = new Set(args.pickedScenarioIds);
  const picked = args.scenarios.filter((s) => pickedSet.has(s.id));
  const pickedBlock = picked
    .map(
      (s) =>
        `### [${s.id}] ${s.title}\n${s.meta}\n${s.narrative}\n（涉及 Jobs: ${s.job_ids.join(', ') || '未指定'}）`,
    )
    .join('\n\n');

  const jobsBlock = args.lockedJobs.map((j) => `- [${j.id}] ${j.title}`).join('\n');

  const res = await runAi({
    task: 'SCEN_PAIN',
    messages: [
      { role: 'system', content: DEEP_PROMPT },
      {
        role: 'user',
        content:
          `${context}\n\n## 用户选入深入分析的 ${picked.length} 个情景\n${pickedBlock}\n\n` +
          `## 已锁 Jobs（矩阵列头）\n${jobsBlock}\n\n` +
          `请一次产出：矩阵 · 极值情景 · 敌意情景 · 痛点连续追问 · 快点 · 设计启发 · critiques。`,
      },
    ],
    schema: DEEP_JSON_SCHEMA,
    maxTokens: 16000,
    temperature: 0.35,
    override: args.override,
  });
  return ScenarioDeepAnalysisSchema.parse(res.data);
}
