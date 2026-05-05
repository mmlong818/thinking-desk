import { z } from 'zod';
import { runAi } from '../router';
import type { BriefExtraction, ClarificationAnswer } from './extract-brief';
import type { Persona, Job } from './analyze-users';
import type { AlternativesAnalysis } from './analyze-alternatives';
import type { Feature, FeatureList } from './draft-features';

/**
 * 方法论 v2 §十 创造性跃迁。
 * 三种可操作方法：
 *  - 10.1 第一性原理 —— 剥离行业惯例，从物理 / 底层规律重推
 *  - 10.2 类比迁移 —— 把成熟领域的结构平移到新领域
 *  - 10.3 约束反转与极端化 —— 去掉 / 加一个 / 反转核心约束
 *
 * §10.4 强调这不是每个项目都该用的工具，成本高失败率高。
 * 适用时机：进入成熟红海 · 强烈怀疑行业共识 · 走完标准分析发现方案平庸。
 */

// --- Schemas ---

export const FirstPrincipleRethinkSchema = z.object({
  id: z.string(),
  /** 当前行业默认的假设 · 例如"锂电池必须贵" */
  industry_assumption: z.string(),
  /** 把它拆到物理 / 底层规律 · 例如"原料价其实只占 15%" */
  physical_floor: z.string(),
  /** 由此推出的新设计机会 */
  opportunity: z.string(),
  /** 可信度 0-3：这条反转在本项目里能落地吗？ */
  feasibility: z.enum(['low', 'medium', 'high']),
});
export type FirstPrincipleRethink = z.infer<typeof FirstPrincipleRethinkSchema>;

export const AnalogyTransferSchema = z.object({
  id: z.string(),
  /** 我们项目的本质问题（不是表层） · 例"本质是撮合" */
  core_essence: z.string(),
  /** 借鉴的源领域 */
  source_domain: z.string(),
  /** 源领域的成熟解法 · 例"做市商 + 集中撮合引擎" */
  source_mechanism: z.string(),
  /** 迁移后的具体动作 */
  transferred_mechanism: z.string(),
  /** 哪些要适配 / 哪些搬不过来 */
  adaptation_notes: z.string(),
  feasibility: z.enum(['low', 'medium', 'high']),
});
export type AnalogyTransfer = z.infer<typeof AnalogyTransferSchema>;

export const ConstraintFlipSchema = z.object({
  id: z.string(),
  /** 类型：去掉 / 加一个 / 反转目标 */
  flip_type: z.enum(['remove_constraint', 'add_constraint', 'reverse_goal']),
  /** 原约束 · 例"用户必须注册账号" */
  original: z.string(),
  /** 反转后 · 例"如果用户不需要注册呢？" */
  flipped: z.string(),
  /** 反转暴露的可能性 */
  surprise: z.string(),
  /** 如果采纳，对当前功能列表的具体影响 */
  impact_on_features: z.string(),
  feasibility: z.enum(['low', 'medium', 'high']),
});
export type ConstraintFlip = z.infer<typeof ConstraintFlipSchema>;

export const LeapRecommendationSchema = z.object({
  /** AI 综合评估：项目适合做多大胆的跃迁
   * - bold：大胆跃迁（推翻多个常规假设，差异化显著）
   * - selective：精选跃迁（选 1-2 个关键点突破，其他保持常规）
   * - minimal：最小跃迁（仅做 1 个最保守的改造，但必须有改造）
   *
   * 注意：v2 方法论里虽然 §10.4 说"大部分项目不需要跃迁"，但**设计的意义正在跃迁处产生**。
   * 即便项目整体保守，也必须选出至少 1 条值得的跃迁——没有跃迁就是"交付常规方案"，不是"设计"。
   */
  timing_verdict: z.enum(['bold', 'selective', 'minimal']),
  timing_reason: z.string(),
  /** 挑出来最值得采纳的 1-3 条跃迁 · 来自上面任一类 · 至少 1 条 */
  top_picks: z.array(
    z.object({
      source_method: z.enum(['first_principles', 'analogy', 'constraint_flip']),
      source_id: z.string(),
      why: z.string(),
      /** 采纳这条意味着功能列表要怎么改 */
      required_changes: z.array(z.string()),
    }),
  ).min(1),
});
export type LeapRecommendation = z.infer<typeof LeapRecommendationSchema>;

export const CreativeLeapAnalysisSchema = z.object({
  first_principles: z.array(FirstPrincipleRethinkSchema).min(4).max(8),
  analogies:        z.array(AnalogyTransferSchema).min(4).max(8),
  constraint_flips: z.array(ConstraintFlipSchema).min(6).max(12),
  recommendation:   LeapRecommendationSchema,
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
export type CreativeLeapAnalysis = z.infer<typeof CreativeLeapAnalysisSchema>;

// --- JSON schema ---

function feasibilityEnum() {
  return { type: 'string', enum: ['low', 'medium', 'high'] };
}

const JSON_SCHEMA = {
  type: 'object',
  required: ['first_principles', 'analogies', 'constraint_flips', 'recommendation', 'critiques'],
  properties: {
    first_principles: {
      type: 'array', minItems: 4, maxItems: 8,
      items: {
        type: 'object',
        required: ['id', 'industry_assumption', 'physical_floor', 'opportunity', 'feasibility'],
        properties: {
          id: { type: 'string' },
          industry_assumption: { type: 'string' },
          physical_floor: { type: 'string' },
          opportunity: { type: 'string' },
          feasibility: feasibilityEnum(),
        },
      },
    },
    analogies: {
      type: 'array', minItems: 4, maxItems: 8,
      items: {
        type: 'object',
        required: ['id', 'core_essence', 'source_domain', 'source_mechanism', 'transferred_mechanism', 'adaptation_notes', 'feasibility'],
        properties: {
          id: { type: 'string' },
          core_essence: { type: 'string' },
          source_domain: { type: 'string' },
          source_mechanism: { type: 'string' },
          transferred_mechanism: { type: 'string' },
          adaptation_notes: { type: 'string' },
          feasibility: feasibilityEnum(),
        },
      },
    },
    constraint_flips: {
      type: 'array', minItems: 6, maxItems: 12,
      items: {
        type: 'object',
        required: ['id', 'flip_type', 'original', 'flipped', 'surprise', 'impact_on_features', 'feasibility'],
        properties: {
          id: { type: 'string' },
          flip_type: { type: 'string', enum: ['remove_constraint', 'add_constraint', 'reverse_goal'] },
          original: { type: 'string' },
          flipped: { type: 'string' },
          surprise: { type: 'string' },
          impact_on_features: { type: 'string' },
          feasibility: feasibilityEnum(),
        },
      },
    },
    recommendation: {
      type: 'object',
      required: ['timing_verdict', 'timing_reason', 'top_picks'],
      properties: {
        timing_verdict: { type: 'string', enum: ['bold', 'selective', 'minimal'] },
        timing_reason: { type: 'string' },
        top_picks: {
          type: 'array',
          minItems: 1,
          maxItems: 3,
          items: {
            type: 'object',
            required: ['source_method', 'source_id', 'why', 'required_changes'],
            properties: {
              source_method: { type: 'string', enum: ['first_principles', 'analogy', 'constraint_flip'] },
              source_id: { type: 'string' },
              why: { type: 'string' },
              required_changes: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
    critiques: {
      type: 'array', maxItems: 5,
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

const SYSTEM_PROMPT = `你是「思考工作台」第 07 创造性跃迁节点的 AI 副驾驶。

# ★ 节点定位（非常重要，不要搞错）
上一节点 §九 功能列表是"基于前面分析的**市场常规方案能力罗列**"——还没有设计。
本节点 §十 创造性跃迁才是**设计真正开始的地方**。
- 功能列表告诉你"行业标准解法长什么样"
- 跃迁告诉你"在哪些点上我们不照抄标准，去做一个重新定义的设计"
- 没有跃迁的产品 = 把需求翻译成常规模板 = 不叫设计
- 有跃迁的产品 = 在关键点上做过独立判断 = 才叫设计

iPhone 不是穷举诺基亚功能来的，它重新定义了"什么是手机"。
Uber 不是在出租车上做增量优化来的，它重新定义了"什么是出行"。
**本节点的输出决定了产品最终有没有差异化。**

# ★★★ 创意密度要求（硬规则 · 不能打折）
**产出量要大、角度要野、跨度要宽**。宁可 8 条里 3 条用户觉得离谱，也不要 4 条平庸安全。
- 每类至少给到规定的最小数量（4/4/6）· 建议靠近最大数量（8/8/12）
- 必须出现**至少 1 条跨行业大跳跃**（例："K12 陪练"借鉴"脱口秀开放麦" / "阿姆斯特朗自行车队补给站"）
- 必须出现**至少 1 条反常识**（"反着做常规"：用户越用越少用、学越多越停）
- 不要所有候选都集中在"优化体验"这一层——
  要覆盖**商业模式** / **交互范式** / **组织架构** / **技术路线** / **时间尺度** / **空间形态** 等多层
- 候选之间要互斥不同维度，不要是同一想法的 3 个变种

# 你的三个任务

## §10.1 第一性原理（first_principles）· 4-8 条
- industry_assumption：列出本领域的"必须如此"共识（例"K12 AI 陪练必须买版权教材"）
- physical_floor：剥到物理 / 底层规律（例"其实讲知识点的权利并不需要版权 · 题目重组也不需要"）
- opportunity：由此推出的设计机会
- feasibility：这个反转在**当前项目团队 / 资源**下的可行度

## §10.2 类比迁移（analogies）· 4-8 条
- core_essence：把当前问题抽象到本质（不是"打车"而是"资源调配"；不是"K12 陪练"而是"让学生愿意继续尝试"）
- source_domain：借鉴的源领域（金融 / 物理 / 生物 / 军事 / 餐饮 / 建筑 / 教育 / 游戏设计...）
- source_mechanism：那个领域的成熟机制（必须具体，不是"激励系统"这种空话）
- transferred_mechanism：迁移到本项目后的具体形态
- adaptation_notes：哪些要适配 / 哪些不能搬
- feasibility

## §10.3 约束反转与极端化（constraint_flips）· 6-12 条
三种类型混搭：
- remove_constraint：去掉一个核心前提（"如果用户不需要注册呢？" / "如果免费呢？" / "如果没网呢？" / "如果没屏幕呢？"）
- add_constraint：加一个极端要求（"如果必须 10 秒完成？" / "如果必须让 80 岁老人也能用？" / "如果只能单手操作？"）
- reverse_goal：反转目标（"如果目标不是让用户停留更久，而是让他尽快离开？" / "如果不是收集更多数据，而是收集更少？"）

对每个反转：
- original：原约束
- flipped：反转陈述
- surprise：反转暴露了什么（这是跃迁的价值所在）
- impact_on_features：如果采纳，当前功能列表的哪些要改 / 删 / 增

# recommendation · 跃迁的胆量级别
timing_verdict **不是"做不做"**（必须做），而是"做多大胆"：
- **bold** —— 项目进入成熟红海 / 强烈怀疑行业共识错了 / 标准方案注定平庸
  → 推荐采纳 2-3 条跃迁，推翻多个常规假设
- **selective** —— 项目大致走标准路径，但有 1-2 个关键点值得突破
  → 推荐采纳 1-2 条跃迁（大部分项目在这一档）
- **minimal** —— 项目本质上要稳 / 时间紧 / 成熟领域
  → 必须**至少采纳 1 条最保守的跃迁**。不能全盘照抄行业模板，那不叫设计。

**timing_reason 里要说清楚为什么是这一档**，不要含糊。

top_picks：至少 1 条，最多 3 条。每条带 required_changes（若采纳，功能列表要怎么改）。
即使是 minimal 档也至少有 1 条。

# 风格
- 这个节点允许"脑洞大开"，但不是凭空想 —— **每条必须能论证**
- 优先脚踏实地的跃迁（feasibility high/medium），low 的最多 1-2 条作为"视野扩展"
- 不要机械套模板 —— 如果某类跃迁本项目真没啥角度，宁可写 2 条有料的，也不凑 5 条废话

# critiques 最多 5 条
用 critique 挑战用户："你在 §七 替代方案里识别的非消费替代其实已经是跃迁的起点 · 要不要把那个深挖？"

# 输出
严格 JSON，不含前后文。`;

function formatContext(
  brief: BriefExtraction,
  personas: Persona[],
  jobs: Job[],
  features: Feature[],
  diff_hypothesis?: string,
  alt_threats?: string[],
  rawText?: string,
  answers?: ClarificationAnswer[],
): string {
  const briefFields = Object.entries(brief.fields)
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(' · ') : v ?? '（未定义）'}`)
    .join('\n');
  const personaBlock = personas.length
    ? personas.slice(0, 4).map((p) => `[${p.id}] ${p.name} · ${p.one_liner}`).join('\n')
    : '（无 persona）';
  const jobBlock = jobs.length
    ? jobs.slice(0, 8).map((j) => `- [${j.id}] ${j.title}`).join('\n')
    : '（无 Job）';
  const featureBlock = features.length
    ? features.slice(0, 12).map((f) => `- [${f.id}] ${f.name} · ${f.kano}`).join('\n')
    : '（无功能列表 · 建议先完成 06）';
  const diffBlock = diff_hypothesis ? `\n\n## 差异化假设\n${diff_hypothesis}` : '';
  const threatsBlock = alt_threats && alt_threats.length > 0
    ? `\n\n## 来自 §七 的核心威胁\n${alt_threats.map((t) => `- ${t}`).join('\n')}`
    : '';
  const answersBlock = answers && answers.length > 0
    ? `\n\n## Brief 澄清\n${answers.map((a) => `- ${a.question}: ${Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer}`).join('\n')}`
    : '';
  const rawBlock = rawText ? `\n\n## Brief 原始\n${rawText.slice(0, 400)}` : '';

  return (
    `## Brief 字段\n${briefFields}\n\n` +
    `## 已选 personas\n${personaBlock}\n\n` +
    `## 已锁 Jobs\n${jobBlock}\n\n` +
    `## 当前功能列表\n${featureBlock}${diffBlock}${threatsBlock}${answersBlock}${rawBlock}`
  );
}

// =============================================================
// 增量生成单类候选
// =============================================================

export type LeapCategory = 'first_principles' | 'analogies' | 'constraint_flips';

export const MoreItemsResultSchema = z.object({
  first_principles: z.array(FirstPrincipleRethinkSchema).optional(),
  analogies: z.array(AnalogyTransferSchema).optional(),
  constraint_flips: z.array(ConstraintFlipSchema).optional(),
});
export type MoreItemsResult = z.infer<typeof MoreItemsResultSchema>;

const MORE_PROMPT = `你是「思考工作台」第 07 创造性跃迁节点的 AI 副驾驶。
用户已经看过上一轮候选，现在<em>要你针对某一类方法再补 3 条新的</em>。

# 硬性要求
1. 必须**和用户锁定的候选互补**（互补 = 不同方向，不是微调变种）
2. 必须**绕开用户已废弃的方向**（rejected 代表那条路走不通 / 不感兴趣，别再提类似的）
3. 如果 existing 列表已经有 id，新生成的 id 必须是全新字符串，避免冲突
4. 每条候选要自带可行度（feasibility）评估

# 输出
严格 JSON，只输出用户请求的那一类，其余留空或不存在：
- 请求 first_principles → { "first_principles": [ 3 条 ] }
- 请求 analogies → { "analogies": [ 3 条 ] }
- 请求 constraint_flips → { "constraint_flips": [ 3 条 ] }
不含前后文、不用 Markdown。`;

function buildMoreJsonSchema(category: LeapCategory) {
  const itemByCat = {
    first_principles: {
      type: 'object',
      required: ['id', 'industry_assumption', 'physical_floor', 'opportunity', 'feasibility'],
      properties: {
        id: { type: 'string' },
        industry_assumption: { type: 'string' },
        physical_floor: { type: 'string' },
        opportunity: { type: 'string' },
        feasibility: feasibilityEnum(),
      },
    },
    analogies: {
      type: 'object',
      required: ['id', 'core_essence', 'source_domain', 'source_mechanism', 'transferred_mechanism', 'adaptation_notes', 'feasibility'],
      properties: {
        id: { type: 'string' },
        core_essence: { type: 'string' },
        source_domain: { type: 'string' },
        source_mechanism: { type: 'string' },
        transferred_mechanism: { type: 'string' },
        adaptation_notes: { type: 'string' },
        feasibility: feasibilityEnum(),
      },
    },
    constraint_flips: {
      type: 'object',
      required: ['id', 'flip_type', 'original', 'flipped', 'surprise', 'impact_on_features', 'feasibility'],
      properties: {
        id: { type: 'string' },
        flip_type: { type: 'string', enum: ['remove_constraint', 'add_constraint', 'reverse_goal'] },
        original: { type: 'string' },
        flipped: { type: 'string' },
        surprise: { type: 'string' },
        impact_on_features: { type: 'string' },
        feasibility: feasibilityEnum(),
      },
    },
  } as const;
  return {
    type: 'object',
    required: [category],
    properties: {
      [category]: {
        type: 'array',
        minItems: 2,
        maxItems: 4,
        items: itemByCat[category],
      },
    },
  };
}

function formatItemsForMore(existing: unknown[]): string {
  if (existing.length === 0) return '（没有已有候选 · 这是第一批）';
  return JSON.stringify(existing, null, 2);
}

export async function generateMoreLeapItems(args: {
  brief: BriefExtraction;
  rawText?: string;
  answers?: ClarificationAnswer[];
  personas: Persona[];
  lockedJobs: Job[];
  features: Feature[];
  differentiation_hypothesis?: string;
  alt_threats?: string[];
  category: LeapCategory;
  existing: unknown[];
  locked_ids: string[];
  rejected_ids: string[];
  override?: string;
}): Promise<MoreItemsResult> {
  const context = formatContext(
    args.brief, args.personas, args.lockedJobs, args.features,
    args.differentiation_hypothesis, args.alt_threats,
    args.rawText, args.answers,
  );
  const existingBlock = formatItemsForMore(args.existing);
  const lockedBlock =
    args.locked_ids.length > 0
      ? `已锁定（与这些互补）：${args.locked_ids.join(', ')}`
      : '无锁定';
  const rejectedBlock =
    args.rejected_ids.length > 0
      ? `已废弃（绕开这些方向）：${args.rejected_ids.join(', ')}`
      : '无已废弃';

  const res = await runAi({
    task:
      args.category === 'first_principles'
        ? 'LEAP_FIRST_PRINCIPLES'
        : args.category === 'analogies'
          ? 'LEAP_ANALOGY'
          : 'LEAP_CONSTRAINT_FLIP',
    messages: [
      { role: 'system', content: MORE_PROMPT },
      {
        role: 'user',
        content:
          `${context}\n\n` +
          `## 已有候选（${args.category}）\n\`\`\`json\n${existingBlock}\n\`\`\`\n\n` +
          `${lockedBlock}\n${rejectedBlock}\n\n` +
          `请为 "${args.category}" 类别补 3 条新的 · 与已锁定互补 · 绕开已废弃方向。`,
      },
    ],
    schema: buildMoreJsonSchema(args.category),
    maxTokens: 6000,
    temperature: 0.75,
    override: args.override,
  });
  return MoreItemsResultSchema.parse(res.data);
}

export async function analyzeCreativeLeap(args: {
  brief: BriefExtraction;
  rawText?: string;
  answers?: ClarificationAnswer[];
  personas: Persona[];
  lockedJobs: Job[];
  features: Feature[];
  differentiation_hypothesis?: string;
  alt_threats?: string[];
  override?: string;
}): Promise<CreativeLeapAnalysis> {
  const context = formatContext(
    args.brief,
    args.personas,
    args.lockedJobs,
    args.features,
    args.differentiation_hypothesis,
    args.alt_threats,
    args.rawText,
    args.answers,
  );
  const res = await runAi({
    task: 'LEAP_FIRST_PRINCIPLES',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `请基于以下上下文做完整的创造性跃迁分析：\n\n${context}\n\n` +
          `要求：\n` +
          `1. §10.1 第一性原理至少 2 条 · 每条要能引用到具体的"行业共识"\n` +
          `2. §10.2 类比迁移至少 2 条 · source_domain 要跨学科多样\n` +
          `3. §10.3 约束反转至少 3 条 · 三种类型都要出现\n` +
          `4. recommendation：\n` +
          `   - timing_verdict 是跃迁的胆量级别（bold / selective / minimal）\n` +
          `   - top_picks **至少 1 条**（即使最保守的项目也必须有 1 个跃迁点，不然就不是设计）\n` +
          `   - 每条 top_pick 必须带 required_changes（功能列表要怎么改）`,
      },
    ],
    schema: JSON_SCHEMA,
    maxTokens: 16000,
    temperature: 0.88, // 创意密度高于默认 · 允许野路子
    override: args.override,
  });
  return CreativeLeapAnalysisSchema.parse(res.data);
}
