import type { NodeKind } from '../../data/nodes';
import { SEVERITY_LABEL } from '../ai/schemas/consistency-check';
import { ruleFindings } from '../model/consistency';
import type { ItemOfType } from '../model/context';
import { itemSummary } from '../model/feedback';
import { indexById, liveGraph, type Graph } from '../model/graph';
import type { Item } from '../model/item-types';
import type { ItemType, LinkRel } from '../model/types';

// PRD Markdown built deterministically from the accepted items (no AI call): the same graph and
// date give the same file. Every line carries a compact provenance tag 〔origin·stance〕.

type Body<T extends ItemType> = ItemOfType<T>['body'];
type Section = Extract<Body<'design_section'>, { kind: string }>;

interface Ctx {
  items: Item[];
  byId: Map<string, Item>;
  graph: Graph;
}

const ORIGIN: Record<Item['origin'], string> = { ai: 'AI', ai_edited: 'AI·改', human: '人' };
const STANCE = { recommend: '荐', neutral: '中', caution: '慎' } as const;

/** 〔AI·荐〕: who produced it (AI, AI then edited by a person, a person) and the AI's stance. */
export function provenance(item: Item): string {
  const stance = item.origin !== 'human' && item.aiStance ? `·${STANCE[item.aiStance.verdict]}` : '';
  return `〔${ORIGIN[item.origin]}${stance}〕`;
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const clip = (text: string, max = 200) => (oneLine(text).length > max ? `${oneLine(text).slice(0, max - 1)}…` : oneLine(text));
const cell = (text: string | number) => oneLine(String(text)).replace(/\|/g, '\\|');

function accepted<T extends ItemType>(ctx: Ctx, type: T, node?: NodeKind): ItemOfType<T>[] {
  return ctx.items.filter((i): i is ItemOfType<T> => i.type === type && i.decision === 'accepted' && (!node || i.node === node));
}

function linkedNames(ctx: Ctx, from: string, rel: LinkRel): string[] {
  return ctx.graph.links
    .filter((l) => l.from === from && l.rel === rel)
    .map((l) => ctx.byId.get(l.to))
    .filter((i): i is Item => !!i && i.decision === 'accepted')
    .map(itemSummary);
}

const bullets = (lines: string[], empty = '- （尚无已采纳内容）') => (lines.length > 0 ? lines : [empty]);

/** Items left pending that a section leaves out: said, so an empty section is not read as "none". */
function pendingNote(ctx: Ctx, keep: (i: Item) => boolean): string[] {
  const n = ctx.items.filter((i) => i.decision === 'pending' && keep(i)).length;
  return n > 0 ? ['', `另有 ${n} 条待裁决，未收入。`] : [];
}

function background(ctx: Ctx): string[] {
  const [brief] = accepted(ctx, 'brief');
  const f = brief?.body.fields;
  const field = (label: string, v?: string | null) => `- **${label}**：${v ? oneLine(v) : '—'}`;
  const lines = brief && f ? [
    `${provenance(brief)} 完整度 ${brief.body.completeness}/100`, '',
    field('问题陈述', f.problem_statement), field('目标用户', f.target_user), field('使用情景', f.scenario),
    field('价值主张', f.value_prop), field('成功标准', f.success_criteria), field('时间约束', f.time_constraint),
    `- **明确边界**：${f.boundaries.length > 0 ? f.boundaries.join('；') : '—'}`,
  ] : ['（Brief 尚未采纳）'];
  const redLines = accepted(ctx, 'red_line').map((r) => `- ${oneLine(r.body.text)} ${provenance(r)}`);
  return ['## 1. 背景与问题', '', ...lines, '', '### 道德红线', ...bullets(redLines), ...pendingNote(ctx, (i) => i.type === 'red_line'), ''];
}

const DIMENSION = { functional: '功能性', emotional: '情感性', social: '社交性' } as const;

function usersAndJobs(ctx: Ctx): string[] {
  const personas = accepted(ctx, 'persona').map((p) =>
    `- **${oneLine(p.body.name)}**（${p.body.role === 'primary' ? '主要' : '候选'}）：${oneLine(p.body.one_liner)} ${provenance(p)}`);
  const jobs = accepted(ctx, 'job').map((j) => {
    const who = linkedNames(ctx, j.id, 'derived_from').map((n) => n.split(' · ')[0]);
    return `- [${DIMENSION[j.body.dimension]}] ${oneLine(j.body.title)}${who.length ? `（${who.join('、')}）` : ''} ${provenance(j)}`;
  });
  return ['## 2. 用户与 Job', '', '### 用户画像', ...bullets(personas), '', '### Jobs-to-be-done', ...bullets(jobs), ''];
}

const LEVEL = { high: '高', low: '低' } as const;

function stakeholders(ctx: Ctx): string[] {
  const list = accepted(ctx, 'stakeholder').map((s) =>
    `- **${oneLine(s.body.name)}**（${oneLine(s.body.role)} · 影响力${LEVEL[s.body.power]} · 关注度${LEVEL[s.body.interest]}）：${clip(s.body.note)} ${provenance(s)}`);
  const [plan] = accepted(ctx, 'engagement_plan');
  const planLines = plan ? [
    '', '### 沟通节奏', `- 重点管理：${oneLine(plan.body.manage)}`, `- 令其满意：${oneLine(plan.body.satisfy)}`,
    `- 保持告知：${oneLine(plan.body.inform)}`, `- 持续关注：${oneLine(plan.body.monitor)}`,
  ] : [];
  return ['## 3. 干系人', '', ...bullets(list), ...planLines, ''];
}

const CATEGORY = { direct: '直接', indirect: '间接', non_consumption: '非消费' } as const;
const THREAT = { high: '高', medium: '中', low: '低' } as const;

function alternatives(ctx: Ctx): string[] {
  const list = accepted(ctx, 'alternative').map((a) =>
    `- **${oneLine(a.body.name)}**（${CATEGORY[a.body.category]} · 威胁${THREAT[a.body.threat_level]}）：${clip(a.body.description)} ${provenance(a)}`);
  const [hyp] = accepted(ctx, 'diff_hypothesis');
  const hypLines = hyp
    ? ['', '### 差异化假设', `> ${oneLine(hyp.body.statement)} ${provenance(hyp)}`, ...hyp.body.key_threats.map((t) => `- 关键威胁：${oneLine(t)}`)]
    : ['', '### 差异化假设', '（尚未采纳）'];
  return ['## 4. 替代方案与差异化', '', ...bullets(list), ...hypLines, ''];
}

function scenarios(ctx: Ctx): string[] {
  const list = accepted(ctx, 'scenario').map((s) => `- **${oneLine(s.body.title)}**：${clip(s.body.narrative)} ${provenance(s)}`);
  const pains = accepted(ctx, 'pain_point').map((p) => `- ${oneLine(p.body.moment)} → 根因：${clip(p.body.root_cause, 120)} ${provenance(p)}`);
  const insights = accepted(ctx, 'insight').map((i) => `- ${clip(i.body.insight_text)} → ${clip(i.body.action, 120)} ${provenance(i)}`);
  return [
    '## 5. 情景与洞察', '', '### 情景', ...bullets(list), '', '### 痛点', ...bullets(pains), '',
    '### 设计启发', ...bullets(insights), '',
  ];
}

/** The design's (revised) list once anything on `final` is accepted, else the feat node's. */
function featureNode(ctx: Ctx): NodeKind {
  return accepted(ctx, 'feature', 'final').length > 0 ? 'final' : 'feat';
}

function features(ctx: Ctx): string[] {
  const node = featureNode(ctx);
  const list = [...accepted(ctx, 'feature', node)].sort((a, b) => b.body.rice_score - a.body.rice_score);
  const rows = list.map((f, i) => [
    i + 1, f.body.name, f.body.pillar, f.body.kano, f.body.rice_score.toFixed(1),
    f.aiStance?.verdict === 'recommend' ? 'AI 建议优先' : '', clip(f.body.core_hypothesis, 80), provenance(f),
  ].map(cell).join(' | '));
  const table = rows.length > 0
    ? ['| # | 功能 | 支柱 | Kano | RICE | 优先级 | 核心假设 | 来源 |', '|---|---|---|---|---|---|---|---|', ...rows.map((r) => `| ${r} |`)]
    : ['（尚无已采纳的功能）'];
  const notDoing = accepted(ctx, 'not_doing', node).map((n) => `- **${oneLine(n.body.name)}**：${clip(n.body.why, 120)} ${provenance(n)}`);
  return [
    `## 6. 功能（按 RICE 排序 · 来自${node === 'final' ? ' 08 设计案的修订版' : ' 06 功能列表'}）`, '', ...table, '',
    '### 不做什么', ...bullets(notDoing), ...pendingNote(ctx, (i) => i.type === 'not_doing' && i.node === node), '',
  ];
}

function sectionLine(s: Section): string[] {
  switch (s.kind) {
    case 'overview': return [`**${oneLine(s.title)}** —— ${oneLine(s.one_liner)}`, '', clip(s.vision, 600)];
    case 'principles': return s.items.map((p) => `- ${oneLine(p)}`);
    case 'flow': return [`- **${oneLine(s.name)}**：${oneLine(s.goal)}`, ...s.steps.map((st) => `  ${st.step}. ${oneLine(st.actor)}：${oneLine(st.action)} → ${oneLine(st.system_response)}`)];
    case 'data_entity': return [`- **${oneLine(s.name)}**：${oneLine(s.description)}（${s.fields.map((f) => f.name).join('、')}）`];
    case 'metric': return [`- **${oneLine(s.name)}**：${oneLine(s.definition)} · 目标 ${oneLine(s.target)}`];
    case 'milestone': return [`- **${oneLine(s.phase)}**（${oneLine(s.duration)}）：${oneLine(s.goal)} · 交付 ${s.deliverables.join('、')}`];
    case 'risk': return [`- ${oneLine(s.risk)} → 缓解：${oneLine(s.mitigation)}`];
    case 'open_question': return [`- ${oneLine(s.text)}`];
    default: return [`- **${oneLine(s.title)}**：${clip(s.body, 300)}`];
  }
}

const DESIGN_PARTS: Array<[Section['kind'], string]> = [
  ['overview', '概述'], ['principles', '设计原则'], ['ia', '信息架构'], ['flow', '关键用户流'], ['interaction', '核心交互'],
  ['data_entity', '数据模型'], ['tech', '技术骨架'], ['metric', '指标'], ['milestone', '里程碑'],
];

function sectionsOf(ctx: Ctx, kind: Section['kind']) {
  return accepted(ctx, 'design_section').filter((s) => s.body.kind === kind);
}

function design(ctx: Ctx): string[] {
  const out = ['## 7. 设计', ''];
  for (const [kind, title] of DESIGN_PARTS) {
    const parts = sectionsOf(ctx, kind);
    if (parts.length === 0) continue;
    out.push(`### ${title}`, ...parts.flatMap((p) => [...sectionLine(p.body), `  ${provenance(p)}`]), '');
  }
  if (out.length === 2) out.push('（尚无已采纳的设计章节）', '');
  return out;
}

function modules(ctx: Ctx): string[] {
  const list = accepted(ctx, 'module').map((m) => {
    const feats = linkedNames(ctx, m.id, 'implements').map((n) => n.split(' · ')[0]);
    const deps = linkedNames(ctx, m.id, 'depends_on').map((n) => n.split(' · ')[0]);
    return `- **${oneLine(m.body.name)}**：${clip(m.body.responsibility, 160)} · 实现：${feats.join('、') || '—'}` +
      `${deps.length ? ` · 依赖：${deps.join('、')}` : ''} ${provenance(m)}`;
  });
  return ['## 8. 模块', '', ...bullets(list), ''];
}

const ASSUMPTION_STATUS = { untested: '未验证', validated: '已验证', refuted: '已证伪', evolved: '已演化' } as const;

function risks(ctx: Ctx): string[] {
  const riskLines = sectionsOf(ctx, 'risk').flatMap((r) => sectionLine(r.body).map((l) => `${l} ${provenance(r)}`));
  const assumptions = accepted(ctx, 'assumption').map((a) =>
    `- ${oneLine(a.body.statement)}（${ASSUMPTION_STATUS[a.body.status]}）${provenance(a)}`);
  return [
    '## 9. 风险与假设', '', '### 风险', ...bullets(riskLines), '',
    '### 关键假设', ...bullets(assumptions), ...pendingNote(ctx, (i) => i.type === 'assumption'), '',
  ];
}

function openQuestions(ctx: Ctx): string[] {
  const list = sectionsOf(ctx, 'open_question').flatMap((q) => sectionLine(q.body).map((l) => `${l} ${provenance(q)}`));
  const isQuestion = (i: Item) => i.type === 'design_section' && i.body.kind === 'open_question';
  return ['## 10. 待决问题', '', ...bullets(list, '- （没有已采纳的待决问题）'), ...pendingNote(ctx, isQuestion), ''];
}

function findings(ctx: Ctx): string[] {
  const confirmed = accepted(ctx, 'finding').map((f) => {
    const involved = ctx.graph.links.filter((l) => l.from === f.id && l.rel === 'conflicts_with')
      .map((l) => ctx.byId.get(l.to)).filter((i): i is Item => !!i).map((i) => `「${itemSummary(i)}」`);
    return `- [${SEVERITY_LABEL[f.body.severity]}] **${oneLine(f.body.title)}**：${clip(f.body.description)} · 建议：${clip(f.body.suggested_fix, 120)}` +
      `${involved.length ? ` · 涉及 ${involved.join('、')}` : ''} ${provenance(f)}`;
  });
  const pending = ctx.items.filter((i) => i.type === 'finding' && i.decision === 'pending').length;
  const rules = ruleFindings(ctx.graph).map((r) => `- ${r.message}`);
  return [
    '## 11. 一致性发现', '', '### 已确认的问题（AI 检查，经人确认）', ...bullets(confirmed, '- （没有）'),
    ...(pending > 0 ? ['', `另有 ${pending} 条 AI 发现尚未裁决，未收入。`] : []),
    '', '### 规则检查（自动）', ...bullets(rules, '- （没有发现结构性缺口）'), '',
  ];
}

export interface PrdOptions {
  now?: Date;
}

export function toPrdMarkdown(project: string, graph: Graph, opts: PrdOptions = {}): string {
  const live = liveGraph(graph.items, graph.links);
  const ctx: Ctx = { items: live.items, byId: indexById(live.items), graph: live };
  const date = (opts.now ?? new Date()).toISOString().slice(0, 10);
  return [
    `# ${project} · 产品需求文档（PRD）`, '',
    `> 思考工作台根据已采纳的条目生成 · ${date} · 只收录已采纳的内容（待定与已否决的不收）`,
    '> 来源标记〔来源·立场〕：AI = AI 产出 · AI·改 = AI 产出后经人修改 · 人 = 人工添加；荐 / 中 / 慎 = AI 当时的立场（推荐 / 中立 / 提醒谨慎）', '',
    ...background(ctx), ...usersAndJobs(ctx), ...stakeholders(ctx), ...alternatives(ctx), ...scenarios(ctx),
    ...features(ctx), ...design(ctx), ...modules(ctx), ...risks(ctx), ...openQuestions(ctx), ...findings(ctx),
  ].join('\n');
}
