import { runAi } from '../router';
import type { Feature, FeatureList } from '../schemas/draft-features';
import type { CreativeLeapAnalysis } from '../schemas/creative-leap';
import type { BriefExtraction, ClarificationAnswer } from '../schemas/extract-brief';
import { FeatureRevisionSchema, type FeatureRevision } from '../schemas/revise-features';

/**
 * 把用户采纳的跃迁应用到功能列表，产出"修订后的最终功能列表"。
 * 这是 §十 → §九 的回流 —— 跃迁只有影响了功能，才真正是设计。
 */

// ---- JSON schema (镜像 zod 上面的) ----
const JSON_SCHEMA = {
  type: 'object',
  required: [
    'revised_features', 'revised_pillars', 'revisions', 'revised_not_doing',
    'differentiation_echo', 'summary', 'critiques',
  ],
  properties: {
    revised_features: {
      type: 'array', minItems: 3,
      items: {
        type: 'object',
        required: [
          'id', 'name', 'description', 'pillar', 'group',
          'traces', 'kano', 'rice', 'rice_score',
          'five_questions',
          'core_hypothesis', 'validation_metric', 'failure_signal',
          'ethics_concern', 'red_line_risk', 'suggested_priority',
        ],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
          pillar: { type: 'string' },
          group: { type: 'string' },
          traces: {
            type: 'object',
            required: ['insight_ids', 'job_ids', 'persona_ids', 'scenario_ids'],
            properties: {
              insight_ids: { type: 'array', items: { type: 'string' } },
              job_ids: { type: 'array', items: { type: 'string' } },
              persona_ids: { type: 'array', items: { type: 'string' } },
              scenario_ids: { type: 'array', items: { type: 'string' } },
            },
          },
          kano: { type: 'string', enum: ['must', 'performance', 'delight', 'indifferent', 'reverse'] },
          rice: {
            type: 'object',
            required: ['reach', 'impact', 'confidence', 'effort'],
            properties: {
              reach: { type: 'number' },
              impact: { type: 'number', enum: [0.25, 0.5, 1, 2, 3] },
              confidence: { type: 'number', enum: [0.5, 0.8, 1] },
              effort: { type: 'number' },
            },
          },
          rice_score: { type: 'number' },
          five_questions: {
            type: 'object',
            required: ['why_do', 'why_this_way', 'alternatives', 'what_if_not', 'what_if_wrong'],
            properties: {
              why_do: { type: 'string' },
              why_this_way: { type: 'string' },
              alternatives: { type: 'string' },
              what_if_not: { type: 'string' },
              what_if_wrong: { type: 'string' },
            },
          },
          core_hypothesis: { type: 'string' },
          validation_metric: { type: 'string' },
          failure_signal: { type: 'string' },
          ethics_concern: { type: 'string' },
          red_line_risk: { type: 'boolean' },
          suggested_priority: { type: 'boolean' },
        },
      },
    },
    revised_pillars: {
      type: 'array', minItems: 2, maxItems: 6,
      items: {
        type: 'object',
        required: ['id', 'name', 'description'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
    revisions: {
      type: 'array', minItems: 1,
      items: {
        type: 'object',
        required: ['action', 'reason', 'source_leap_ids'],
        properties: {
          action: { type: 'string', enum: ['added', 'modified', 'removed', 'kept'] },
          feature_id: { type: 'string' },
          original_feature_id: { type: 'string' },
          name_before: { type: 'string' },
          name_after: { type: 'string' },
          reason: { type: 'string' },
          source_leap_ids: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    revised_not_doing: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'reason', 'why'],
        properties: {
          name: { type: 'string' },
          reason: { type: 'string', enum: ['boundary', 'ethics', 'indifferent', 'low_rice', 'dependency'] },
          why: { type: 'string' },
        },
      },
    },
    differentiation_echo: { type: 'string' },
    summary: { type: 'string' },
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

const SYSTEM_PROMPT = `你是「思考工作台」的 AI 副驾驶。
用户刚从 §十 创造性跃迁节点选出了几条要采纳的跃迁，现在你要**回到 §九 功能列表**，
根据采纳的跃迁**修订功能列表**，产出最终版本。

# 这步是方法论的闭环
跃迁只有影响了功能列表，才真正叫"设计"。如果跃迁列一堆但功能列表纹丝不动，
那就是空谈。你的产出决定了"修订前的常规功能列表 → 修订后的最终功能列表"的距离。

# 对每个原功能，做四种决定之一
- **kept** —— 跃迁不改变它，保留原样
- **modified** —— 跃迁改变了它的形态。name / description / 假设 / RICE 可能变
- **removed** —— 跃迁否定了它的必要性。把它移到 revised_not_doing
- **added** —— 跃迁催生了原列表里没有的新能力。加一条新 feature

原则：
- 不要为了"显得有修订"而硬改——某条跃迁如果只影响 1 个功能，就只改 1 个
- 但如果 3 条跃迁都被采纳却只改 1 个功能，说明你理解跃迁不够深
- modified 的功能必须实质性变化，不是改改文案。如果只是微调，当作 kept

# revisions 清单
每次变更写一条 RevisionNote：
- action: added / modified / removed / kept（kept 可选，重要的 kept 可以列出解释为什么被保留）
- 涉及 source_leap_ids：指向 §十 跃迁的 id
- reason 写清楚"为什么是这个决定"

# revised_features
完整输出修订后的功能列表（不是只输出变动的）。保留 Kano / RICE / 五问 / 假设 / 来源追溯等所有字段。
如果这是一个新 added 的 feature，id 用新字符串，**和修订前的 id 不能冲突**。
如果是 modified，**保持原 id**（这样 revisions.original_feature_id = feature_id 可链接）。

# revised_pillars
根据修订后的功能列表，调整支柱。可以保留原支柱，也可以合并 / 新增。

# revised_not_doing
原"不做清单" + 因为跃迁而新加入的 + 因为跃迁而重新评估要做的移除掉。

# differentiation_echo
一句话：修订后的功能列表是否回应了跃迁提出的"我们凭什么不同"？
回应到了就写清楚；没回应到就直接说"差异化依然薄弱，建议补 XX"。

# summary
1-2 段：这次修订改了什么 · 为什么 · 修订后的功能列表和原始比最大的差别是什么。

# critiques 最多 5 条
如果用户采纳的跃迁互相冲突、或有关键缺口，用 critique 或 ask 指出来。

# 输出
严格 JSON · 不含前后文 · 不用 Markdown。`;

function formatLeapsForRevision(
  leaps: CreativeLeapAnalysis,
  selectedIds: string[],
): string {
  const picked: Array<{ id: string; kind: string; text: string }> = [];
  for (const it of leaps.first_principles) {
    if (selectedIds.includes(it.id)) {
      picked.push({ id: it.id, kind: '第一性', text: `${it.industry_assumption} → ${it.physical_floor} → ${it.opportunity}` });
    }
  }
  for (const it of leaps.analogies) {
    if (selectedIds.includes(it.id)) {
      picked.push({ id: it.id, kind: '类比', text: `本质 ${it.core_essence} · 借鉴 ${it.source_domain} · ${it.transferred_mechanism}` });
    }
  }
  for (const it of leaps.constraint_flips) {
    if (selectedIds.includes(it.id)) {
      picked.push({ id: it.id, kind: '反转', text: `${it.original} → ${it.flipped} · 暴露：${it.surprise}` });
    }
  }
  if (picked.length === 0) return '（用户未采纳任何跃迁）';
  return picked.map((p) => `- [${p.id}] [${p.kind}] ${p.text}`).join('\n');
}

function formatOriginalFeatures(list: FeatureList): string {
  const block = list.features
    .map(
      (f) =>
        `### [${f.id}] ${f.name} (${f.kano}, RICE ${f.rice_score})\n` +
        `  描述: ${f.description}\n` +
        `  支柱: ${f.pillar}\n` +
        `  假设: ${f.core_hypothesis}`,
    )
    .join('\n\n');
  const pillars = list.pillars.map((p) => `- [${p.id}] ${p.name}: ${p.description}`).join('\n');
  return `## 支柱\n${pillars}\n\n## 功能\n${block}\n\n## 原 differentiation_echo\n${list.differentiation_echo}`;
}

function formatBriefContext(
  brief: BriefExtraction,
  rawText?: string,
  answers?: ClarificationAnswer[],
): string {
  const fields = Object.entries(brief.fields)
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join(' · ') : v ?? '（未定义）'}`)
    .join('\n');
  const redLines =
    brief.fields.red_lines.length > 0
      ? `\n\n## 道德红线\n${brief.fields.red_lines.map((r) => `- ${r}`).join('\n')}`
      : '';
  const answersBlock =
    answers && answers.length > 0
      ? `\n\n## Brief 澄清\n${answers
          .map((a) => `- ${a.question}: ${Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer}`)
          .join('\n')}`
      : '';
  const rawBlock = rawText ? `\n\n## Brief 原始\n${rawText.slice(0, 400)}` : '';
  return `## Brief 字段\n${fields}${redLines}${answersBlock}${rawBlock}`;
}

export async function reviseFeaturesWithLeaps(args: {
  brief: BriefExtraction;
  rawText?: string;
  answers?: ClarificationAnswer[];
  original: FeatureList;
  leaps: CreativeLeapAnalysis;
  selectedLeapIds: string[];
  override?: string;
}): Promise<FeatureRevision> {
  const briefCtx = formatBriefContext(args.brief, args.rawText, args.answers);
  const leapBlock = formatLeapsForRevision(args.leaps, args.selectedLeapIds);
  const originalBlock = formatOriginalFeatures(args.original);

  const res = await runAi({
    task: 'FEAT_DRAFT',
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      {
        role: 'user',
        content:
          `${briefCtx}\n\n` +
          `## 用户采纳的跃迁（${args.selectedLeapIds.length} 条）\n${leapBlock}\n\n` +
          `## 修订前的功能列表（§九 产出）\n${originalBlock}\n\n` +
          `请基于采纳的跃迁修订功能列表，产出：revised_features · revised_pillars · revisions · revised_not_doing · differentiation_echo · summary · critiques`,
      },
    ],
    schema: JSON_SCHEMA,
    maxTokens: 16000,
    temperature: 0.4,
    override: args.override,
  });

  const parsed = FeatureRevisionSchema.parse(res.data);
  // Defensive: recompute RICE score client-side
  parsed.revised_features = parsed.revised_features.map((f: Feature) => {
    const computed = (f.rice.reach * f.rice.impact * f.rice.confidence) / Math.max(f.rice.effort, 0.1);
    return { ...f, rice_score: Math.round(computed * 10) / 10 };
  });
  return parsed;
}
