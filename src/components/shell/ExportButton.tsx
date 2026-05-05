'use client';

import { useState } from 'react';
import { NODES } from '@/data/nodes';
import { readCache } from '@/lib/client-cache';
import { listLocalProjects } from '@/lib/client-projects';

interface Props {
  projectSlug: string;
  projectName: string;
}

type Fmt = 'md' | 'json';

export function ExportButton({ projectSlug, projectName }: Props) {
  const [open, setOpen] = useState(false);

  const realName = (() => {
    try {
      const decoded = decodeURIComponent(projectSlug);
      const hit = listLocalProjects().find((p) => p.slug === projectSlug || p.slug === decoded);
      return hit?.name ?? projectName;
    } catch {
      return projectName;
    }
  })();

  const collect = () => {
    const bundle: Record<string, unknown> = {};
    for (const n of NODES) {
      const v = readCache<unknown>(projectSlug, n.kind);
      if (v != null) bundle[n.kind] = v;
    }
    // 设计案 / 子功能拆分各自独立缓存键
    const design = readCache<unknown>(projectSlug, 'design');
    if (design) bundle['design'] = design;
    const split = readCache<unknown>(projectSlug, 'split');
    if (split) bundle['split'] = split;
    return bundle;
  };

  const download = (text: string, ext: string, mime: string) => {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    a.href = url;
    a.download = `${realName}-${stamp}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const exportNow = (fmt: Fmt) => {
    const bundle = collect();
    if (Object.keys(bundle).length === 0) {
      alert('当前项目还没有任何节点产出，先跑几个节点再导出。');
      return;
    }
    if (fmt === 'json') {
      download(JSON.stringify({ project: realName, exportedAt: new Date().toISOString(), nodes: bundle }, null, 2), 'json', 'application/json');
    } else {
      download(toMarkdown(realName, bundle), 'md', 'text/markdown');
    }
    setOpen(false);
  };

  return (
    <div style={{ position: 'relative' }}>
      <button className="btn btn-ghost" type="button" onClick={() => setOpen((v) => !v)}>导出</button>
      {open ? (
        <div
          className="export-menu"
          onMouseLeave={() => setOpen(false)}
        >
          <button className="export-menu-item" onClick={() => exportNow('md')}>
            <b>Markdown</b>
            <span className="dim">一份汇总文档 · 适合阅读 / 复制</span>
          </button>
          <button className="export-menu-item" onClick={() => exportNow('json')}>
            <b>JSON</b>
            <span className="dim">完整结构化数据 · 适合二次处理</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function toMarkdown(name: string, bundle: Record<string, unknown>): string {
  const lines: string[] = [];
  lines.push(`# ${name}`);
  lines.push('');
  lines.push(`> 思考工作台导出 · ${new Date().toLocaleString('zh-CN')}`);
  lines.push('');

  // 把 standalone 的 design 缓存合并到 final 节点里，方便统一在 08 渲染。
  const standaloneDesign = bundle['design'];
  for (const node of NODES) {
    let v = bundle[node.kind];
    if (node.kind === 'final') {
      const fc = (v ?? {}) as { design?: unknown };
      if (!fc.design && standaloneDesign) v = { ...fc, design: standaloneDesign };
      // 若 final 缓存空但有 standalone design，仍然渲染 08
      if ((!v || (typeof v === 'object' && Object.keys(v as object).length === 0)) && standaloneDesign) {
        v = { design: standaloneDesign };
      }
    }
    if (v == null) continue;
    lines.push('---');
    lines.push('');
    lines.push(`## ${node.num} ${node.label} · ${node.sub}`);
    lines.push('');
    lines.push(renderNode(node.kind, v));
    lines.push('');
  }
  return lines.join('\n');
}

function renderNode(kind: string, v: unknown): string {
  try {
    if (kind === 'brief') return renderBrief(v);
    if (kind === 'users') return renderUsers(v);
    if (kind === 'stake') return renderStake(v);
    if (kind === 'alt')   return renderAlt(v);
    if (kind === 'scen')  return renderScen(v);
    if (kind === 'feat')  return renderFeat(v);
    if (kind === 'leap')  return renderLeap(v);
    if (kind === 'final') return renderFinal(v);
    if (kind === 'split') return renderSplit(v);
  } catch {
    /* fall through */
  }
  if (typeof v === 'string') return v;
  return '```json\n' + JSON.stringify(v, null, 2) + '\n```';
}

// ---- per-node renderers ----

function renderBrief(v: unknown): string {
  const b = v as {
    raw_text?: string;
    fields?: Record<string, unknown>;
    highlights?: { text: string; kind: string; reason?: string }[];
    follow_ups?: { field: string; question: string; why?: string }[];
    completeness?: number;
    answers?: { question: string; answer: string | string[] }[];
  };
  const out: string[] = [];
  if (typeof b.completeness === 'number') out.push(`**完整度**：${b.completeness}/100`, '');
  if (b.raw_text) {
    out.push('### 原始陈述', '', '> ' + b.raw_text.replace(/\n/g, '\n> '), '');
  }
  const f = b.fields ?? {};
  const FIELD_LABEL: Record<string, string> = {
    problem_statement: '问题陈述',
    target_user: '目标用户',
    scenario: '使用情景',
    value_prop: '价值主张',
    success_criteria: '成功标准',
    time_constraint: '时间约束',
    boundaries: '边界',
    red_lines: '道德红线',
  };
  out.push('### 字段');
  for (const [k, label] of Object.entries(FIELD_LABEL)) {
    const val = f[k];
    if (val == null || val === '') { out.push(`- **${label}**：—`); continue; }
    if (Array.isArray(val)) out.push(`- **${label}**：${val.length === 0 ? '—' : ''}`, ...val.map((x) => `  - ${String(x)}`));
    else out.push(`- **${label}**：${String(val)}`);
  }
  out.push('');
  if (b.answers?.length) {
    out.push('### 澄清回答');
    b.answers.forEach((a) => out.push(`- **${a.question}** — ${Array.isArray(a.answer) ? a.answer.join(' / ') : a.answer}`));
    out.push('');
  }
  if (b.highlights?.length) {
    out.push('### 高亮');
    b.highlights.forEach((h) => out.push(`- _[${h.kind}]_ ${h.text}${h.reason ? `（${h.reason}）` : ''}`));
    out.push('');
  }
  if (b.follow_ups?.length) {
    out.push('### 待补问题');
    b.follow_ups.forEach((q) => out.push(`- **${q.field}**：${q.question}${q.why ? `（${q.why}）` : ''}`));
    out.push('');
  }
  return out.join('\n');
}

interface JobLite { id: string; title: string; reach: number; impact: number; source?: string; suggested_priority?: boolean }
function renderUsers(v: unknown): string {
  const u = v as {
    personas?: { id: string; role: string; name: string; one_liner: string; meta: string; story: string; pain: string }[];
    extraPersonas?: { id: string; role: string; name: string; one_liner: string; meta: string; story: string; pain: string }[];
    jobs?: { functional: JobLite[]; emotional: JobLite[]; social: JobLite[] };
    priority_summary?: string;
  };
  const out: string[] = [];
  const personas = [...(u.personas ?? []), ...(u.extraPersonas ?? [])];
  if (personas.length) {
    out.push('### 用户角色');
    personas.forEach((p) => {
      out.push(`#### ${p.name} · ${p.role === 'primary' ? '主要' : '候选'}`, '', `_${p.one_liner}_`, '', `- 画像：${p.meta}`, `- 故事：${p.story}`, `- 痛点：${p.pain}`, '');
    });
  }
  const jobs = u.jobs;
  if (jobs) {
    const renderJobGroup = (title: string, list: JobLite[]) => {
      if (!list?.length) return;
      out.push(`### Jobs · ${title}`, '');
      out.push('| Job | Reach | Impact | 来源 | 优先 |');
      out.push('| --- | --- | --- | --- | --- |');
      list.forEach((j) => out.push(`| ${j.title} | ${j.reach} | ${j.impact} | ${j.source ?? ''} | ${j.suggested_priority ? '★' : ''} |`));
      out.push('');
    };
    renderJobGroup('功能', jobs.functional ?? []);
    renderJobGroup('情感', jobs.emotional ?? []);
    renderJobGroup('社交', jobs.social ?? []);
  }
  if (u.priority_summary) out.push('### 优先级判断', '', u.priority_summary, '');
  return out.join('\n');
}

function renderStake(v: unknown): string {
  const s = v as {
    stakeholders?: { id: string; name: string; role: string; power: string; interest: string; category: string; note: string; engagement_hint?: string }[];
    engagement_plan?: { manage: string; satisfy: string; inform: string; monitor: string };
    priority_summary?: string;
  };
  const out: string[] = [];
  if (s.stakeholders?.length) {
    out.push('### Mendelow 矩阵', '');
    out.push('| 干系人 | 角色 | 权力 | 兴趣 | 类型 | 备注 |');
    out.push('| --- | --- | --- | --- | --- | --- |');
    s.stakeholders.forEach((h) => out.push(`| ${h.name} | ${h.role} | ${h.power} | ${h.interest} | ${h.category} | ${h.note} |`));
    out.push('');
  }
  if (s.engagement_plan) {
    out.push('### 参与策略', '');
    out.push(`- **管理（高权高兴趣）**：${s.engagement_plan.manage}`);
    out.push(`- **满足（高权低兴趣）**：${s.engagement_plan.satisfy}`);
    out.push(`- **告知（低权高兴趣）**：${s.engagement_plan.inform}`);
    out.push(`- **监控（低权低兴趣）**：${s.engagement_plan.monitor}`);
    out.push('');
  }
  if (s.priority_summary) out.push('### 总结', '', s.priority_summary, '');
  return out.join('\n');
}

function renderAlt(v: unknown): string {
  const a = v as {
    alternatives?: { id: string; name: string; category: string; description: string; why_users_use: string; threat_level: string; sources?: string[] }[];
    strategic_profiles?: { alt_id: string; promise: string; revenue_model: string; moat: string; moat_strength: string }[];
    feature_breakdowns?: { alt_id: string; menu_structure?: string[]; core_flows?: string[]; key_interactions?: string[]; headline_features?: string[] }[];
    differentiation_hypothesis?: string;
    key_threats?: string[];
  };
  const out: string[] = [];
  const cat: Record<string, string> = { direct: '直接', indirect: '间接', non_consumption: '非消费' };
  if (a.alternatives?.length) {
    out.push('### 替代方案', '');
    out.push('| 名称 | 类别 | 威胁 | 用户为何用 |');
    out.push('| --- | --- | --- | --- |');
    a.alternatives.forEach((x) => out.push(`| ${x.name} | ${cat[x.category] ?? x.category} | ${x.threat_level} | ${x.why_users_use} |`));
    out.push('');
  }
  if (a.strategic_profiles?.length) {
    out.push('### 战略画像（§7.2）');
    a.strategic_profiles.forEach((p) => out.push(`- **${p.alt_id}**：承诺=${p.promise} · 盈利=${p.revenue_model} · 护城河=${p.moat}（${p.moat_strength}）`));
    out.push('');
  }
  if (a.feature_breakdowns?.length) {
    out.push('### 功能拆解（§7.3）');
    a.feature_breakdowns.forEach((f) => {
      out.push(`#### ${f.alt_id}`);
      if (f.menu_structure?.length) out.push(`- 菜单结构：${f.menu_structure.join(' · ')}`);
      if (f.core_flows?.length) out.push(`- 核心流程：${f.core_flows.join(' · ')}`);
      if (f.key_interactions?.length) out.push(`- 关键交互：${f.key_interactions.join(' · ')}`);
      if (f.headline_features?.length) out.push(`- 招牌功能：${f.headline_features.join(' · ')}`);
    });
    out.push('');
  }
  if (a.key_threats?.length) {
    out.push('### 主要威胁');
    a.key_threats.forEach((t) => out.push(`- ${t}`));
    out.push('');
  }
  if (a.differentiation_hypothesis) out.push('### 差异化假设', '', a.differentiation_hypothesis, '');
  return out.join('\n');
}

function renderScen(v: unknown): string {
  const s = v as {
    scenarios?: { id: string; title: string; meta: string; narrative: string; pain_hint: string }[];
    picked_scenario_ids?: string[];
    deep?: {
      matrix?: { scenario_id: string; job_id: string; category: string; frequency: string; importance: string; note: string }[];
      pain_points?: { id: string; scenario_id: string; moment: string; feeling: string; why_1: string; why_2: string; why_3: string; root_cause: string }[];
      delight_points?: { id: string; moment: string; feeling: string; root_reason: string; opportunity: string }[];
      design_insights?: { id: string; insight_text: string; action: string; scenario_id?: string; job_id?: string; pain_id?: string }[];
      extremes?: { id: string; dim: string; pushed_to_limit: string; description: string; robustness_gap: string }[];
      hostiles?: { id: string; attack: string; vulnerable_users: string; mitigation: string; severity: string }[];
    };
  };
  const out: string[] = [];
  if (s.scenarios?.length) {
    out.push('### 情景草稿', '');
    s.scenarios.forEach((x) => {
      const picked = s.picked_scenario_ids?.includes(x.id) ? ' ★' : '';
      out.push(`#### ${x.title}${picked}`, '', `_${x.meta}_`, '', x.narrative, '', `**痛点暗示**：${x.pain_hint}`, '');
    });
  }
  const d = s.deep;
  if (d?.pain_points?.length) {
    out.push('### 痛点根因（连续追问）');
    d.pain_points.forEach((p) => {
      out.push(`- **${p.moment}** — ${p.feeling}`);
      out.push(`  - 为什么？${p.why_1}`);
      out.push(`  - 为什么？${p.why_2}`);
      out.push(`  - 为什么？${p.why_3}`);
      out.push(`  - **根因**：${p.root_cause}`);
    });
    out.push('');
  }
  if (d?.delight_points?.length) {
    out.push('### 快点');
    d.delight_points.forEach((p) => out.push(`- **${p.moment}** · ${p.feeling} → ${p.root_reason}（机会：${p.opportunity}）`));
    out.push('');
  }
  if (d?.extremes?.length) {
    out.push('### 极值情景');
    d.extremes.forEach((e) => out.push(`- **${e.dim} 推到极限**：${e.pushed_to_limit} — ${e.description}（鲁棒性缺口：${e.robustness_gap}）`));
    out.push('');
  }
  if (d?.hostiles?.length) {
    out.push('### 敌意情景');
    d.hostiles.forEach((h) => out.push(`- **${h.attack}** _[${h.severity}]_ — 受害者：${h.vulnerable_users} · 缓解：${h.mitigation}`));
    out.push('');
  }
  if (d?.design_insights?.length) {
    out.push('### 设计启发');
    d.design_insights.forEach((i) => out.push(`- ${i.insight_text}${i.action ? ` → **${i.action}**` : ''}`));
    out.push('');
  }
  return out.join('\n');
}

interface FeatureLite {
  id: string; name: string; description: string; pillar: string;
  kano: string; rice_score: number; suggested_priority?: boolean; red_line_risk?: boolean;
  core_hypothesis?: string; validation_metric?: string; failure_signal?: string;
}
function renderFeat(v: unknown): string {
  const f = v as {
    pillars?: { id: string; name: string; description: string }[];
    features?: FeatureLite[];
    not_doing?: { name: string; reason: string; why: string }[];
    differentiation_echo?: string;
  };
  return featureListMarkdown(f, '常规方案');
}

function renderLeap(v: unknown): string {
  // 缓存格式：{ analysis: CreativeLeapAnalysis, states, locked } —— 解包到 analysis
  const wrapper = v as { analysis?: unknown };
  const l = (wrapper.analysis ?? v) as {
    first_principles?: { id: string; industry_assumption: string; physical_floor: string; opportunity: string; feasibility: string }[];
    analogies?: { id: string; core_essence: string; source_domain: string; source_mechanism: string; transferred_mechanism: string; adaptation_notes: string; feasibility: string }[];
    constraint_flips?: { id: string; flip_type: string; original: string; flipped: string; surprise: string; impact_on_features: string; feasibility: string }[];
    recommendation?: { timing_verdict: string; timing_reason: string; top_picks?: { source_method: string; source_id: string; why: string; required_changes: string[] }[] };
  };
  const out: string[] = [];
  if (l.recommendation) {
    out.push(`### 建议：${l.recommendation.timing_verdict}`, '', l.recommendation.timing_reason, '');
    if (l.recommendation.top_picks?.length) {
      out.push('#### 推荐采纳');
      l.recommendation.top_picks.forEach((p) => {
        out.push(`- **${p.source_method} · ${p.source_id}** — ${p.why}`);
        p.required_changes.forEach((c) => out.push(`  - 需要的改动：${c}`));
      });
      out.push('');
    }
  }
  if (l.first_principles?.length) {
    out.push('### 第一性原理');
    l.first_principles.forEach((p) => out.push(`- **${p.id}** _[${p.feasibility}]_：行业假设「${p.industry_assumption}」→ 物理底「${p.physical_floor}」→ 机会：${p.opportunity}`));
    out.push('');
  }
  if (l.analogies?.length) {
    out.push('### 类比迁移');
    l.analogies.forEach((p) => out.push(`- **${p.id}** _[${p.feasibility}]_：本质「${p.core_essence}」← ${p.source_domain}「${p.source_mechanism}」→ 迁移：${p.transferred_mechanism}（${p.adaptation_notes}）`));
    out.push('');
  }
  if (l.constraint_flips?.length) {
    out.push('### 约束反转');
    l.constraint_flips.forEach((p) => out.push(`- **${p.id}** _[${p.flip_type} · ${p.feasibility}]_：${p.original} → ${p.flipped}（${p.surprise} · 影响：${p.impact_on_features}）`));
    out.push('');
  }
  return out.join('\n');
}

function renderFinal(v: unknown): string {
  const fc = v as { design?: unknown };
  if (fc.design) return renderDesign(fc.design);
  return '_尚未生成设计案_';
}

function featureListMarkdown(
  f: {
    pillars?: { id: string; name: string; description: string }[];
    features?: FeatureLite[];
    not_doing?: { name: string; reason: string; why: string }[];
    differentiation_echo?: string;
  },
  label: string,
): string {
  const out: string[] = [];
  if (f.pillars?.length) {
    out.push('### 支柱');
    f.pillars.forEach((p) => out.push(`- **${p.name}** — ${p.description}`));
    out.push('');
  }
  if (f.features?.length) {
    out.push(`### ${label}（${f.features.length}）`, '');
    out.push('| ID | 功能 | 支柱 | Kano | RICE | 优先 | 描述 |');
    out.push('| --- | --- | --- | --- | --- | --- | --- |');
    f.features.forEach((x) => out.push(
      `| ${x.id} | ${x.name}${x.red_line_risk ? ' ⚠' : ''} | ${x.pillar} | ${x.kano} | ${x.rice_score} | ${x.suggested_priority ? '★' : ''} | ${x.description} |`,
    ));
    out.push('');
    out.push('#### 功能假设详情');
    f.features.forEach((x) => {
      if (!x.core_hypothesis && !x.validation_metric && !x.failure_signal) return;
      out.push(`- **${x.id} · ${x.name}**`);
      if (x.core_hypothesis) out.push(`  - 假设：${x.core_hypothesis}`);
      if (x.validation_metric) out.push(`  - 验证指标：${x.validation_metric}`);
      if (x.failure_signal) out.push(`  - 失败信号：${x.failure_signal}`);
    });
    out.push('');
  }
  if (f.not_doing?.length) {
    out.push('### 不做清单');
    f.not_doing.forEach((n) => out.push(`- **${n.name}** _[${n.reason}]_ — ${n.why}`));
    out.push('');
  }
  if (f.differentiation_echo) out.push('### 差异化对账', '', f.differentiation_echo, '');
  return out.join('\n');
}

interface DesignLike {
  title?: string; one_liner?: string; vision?: string;
  design_principles?: string[];
  modules?: { id: string; name: string; responsibility: string; feature_ids?: string[]; key_screens?: string[] }[];
  user_flows?: { name: string; goal: string; steps?: { step: number; actor: string; action: string; system_response: string }[] }[];
  data_model?: { name: string; description: string; fields: { name: string; type: string; note?: string }[] }[];
  metrics?: { name: string; definition: string; target: string }[];
  risks?: { risk: string; mitigation: string }[];
  milestones?: { phase: string; goal: string; duration: string; deliverables: string[] }[];
  open_questions?: string[];
}

function renderDesign(v: unknown): string {
  const d = v as DesignLike;
  const out: string[] = [];
  if (d.title) out.push(`### ${d.title}`, '');
  if (d.one_liner) out.push(`> ${d.one_liner}`, '');
  if (d.vision) out.push(d.vision, '');
  if (d.design_principles?.length) {
    out.push('**设计原则**');
    out.push(...d.design_principles.map((p) => `- ${p}`));
    out.push('');
  }
  if (d.modules?.length) {
    out.push('### 模块');
    for (const m of d.modules) {
      out.push(`- **${m.name}** · ${m.responsibility}`);
      if (m.feature_ids?.length) out.push(`  - 关联功能：${m.feature_ids.join(', ')}`);
      if (m.key_screens?.length) out.push(`  - 主要屏幕：${m.key_screens.join(' · ')}`);
    }
    out.push('');
  }
  if (d.user_flows?.length) {
    out.push('### 关键用户流');
    for (const f of d.user_flows) {
      out.push(`#### ${f.name}`, '', `_${f.goal}_`, '');
      f.steps?.forEach((s) => out.push(`${s.step}. **${s.actor}** ${s.action} → ${s.system_response}`));
      out.push('');
    }
  }
  if (d.data_model?.length) {
    out.push('### 数据模型');
    for (const e of d.data_model) {
      out.push(`#### ${e.name}`, '', e.description, '');
      out.push('| 字段 | 类型 | 说明 |');
      out.push('| --- | --- | --- |');
      e.fields.forEach((f) => out.push(`| ${f.name} | ${f.type} | ${f.note ?? ''} |`));
      out.push('');
    }
  }
  if (d.metrics?.length) {
    out.push('### 指标');
    out.push('| 指标 | 定义 | 目标 |');
    out.push('| --- | --- | --- |');
    d.metrics.forEach((m) => out.push(`| ${m.name} | ${m.definition} | ${m.target} |`));
    out.push('');
  }
  if (d.risks?.length) {
    out.push('### 风险');
    d.risks.forEach((r) => out.push(`- **${r.risk}** → ${r.mitigation}`));
    out.push('');
  }
  if (d.milestones?.length) {
    out.push('### 里程碑');
    d.milestones.forEach((m) => {
      out.push(`- **${m.phase}** · ${m.duration} · ${m.goal}`);
      m.deliverables.forEach((dv) => out.push(`  - ${dv}`));
    });
    out.push('');
  }
  if (d.open_questions?.length) {
    out.push('### 待决策');
    d.open_questions.forEach((q) => out.push(`- ${q}`));
    out.push('');
  }
  return out.join('\n');
}

interface SplitLike {
  summary?: string;
  total_subfeatures?: number;
  critical_path?: string[];
  splits?: {
    feature_id: string; feature_name: string; module_id?: string;
    subfeatures: { id: string; title: string; description: string; layer: string; estimate: string; acceptance_criteria: string[]; dependencies?: string[] }[];
  }[];
}

function renderSplit(v: unknown): string {
  const d = v as SplitLike;
  const out: string[] = [];
  if (d.summary) out.push(`> ${d.summary}`, '');
  if (d.total_subfeatures != null) out.push(`共 ${d.total_subfeatures} 条子任务${d.critical_path?.length ? ` · 关键路径 ${d.critical_path.length} 条` : ''}`, '');
  if (d.critical_path?.length) out.push(`**关键路径**：${d.critical_path.join(' → ')}`, '');
  d.splits?.forEach((s) => {
    out.push(`### ${s.feature_name}  \`${s.feature_id}\``, '');
    s.subfeatures.forEach((sf) => {
      const dep = sf.dependencies?.length ? ` · 依赖 ${sf.dependencies.join(', ')}` : '';
      out.push(`- **[${sf.layer}]** ${sf.title} · ${sf.estimate}${dep}`);
      out.push(`  - ${sf.description}`);
      sf.acceptance_criteria.forEach((a) => out.push(`  - ✓ ${a}`));
    });
    out.push('');
  });
  return out.join('\n');
}
