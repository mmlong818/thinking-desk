'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { NodeFollowUpsSection } from '@/components/shared/NodeFollowUpsSection';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/schemas/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/schemas/analyze-users';
import type { ScenarioDraft, ScenarioDeepAnalysis } from '@/lib/ai/schemas/analyze-scenarios';
import type { AlternativesAnalysis } from '@/lib/ai/schemas/analyze-alternatives';
import {
  KANO_META,
  type Feature,
  type FeatureList,
  type KanoKind,
  type NotDoing,
  type Pillar,
} from '@/lib/ai/schemas/draft-features';
import { readCache, writeCache } from '@/lib/client-cache';
import { readPreferredModel } from '@/lib/client-model';
import { nextNodeKind, getNode, formatNodeNum } from '@/data/nodes';

interface CachedBrief extends BriefExtraction {
  raw_text?: string;
  answers?: ClarificationAnswer[];
}
interface CachedUsers extends UsersAnalysis {
  extraPersonas?: Persona[];
  personaLocked?: Record<string, boolean>;
  jobLocked?: Record<string, boolean>;
}
interface CachedScen {
  scenarios?: ScenarioDraft[];
  picked_scenario_ids?: string[];
  deep?: ScenarioDeepAnalysis;
}

const KANO_FILTER_KEYS: (KanoKind | 'all')[] = ['all', 'must', 'performance', 'delight', 'reverse'];

const NOT_DOING_REASON: Record<NotDoing['reason'], { label: string; cls: string }> = {
  boundary:    { label: '超出边界',     cls: 'boundary' },
  ethics:      { label: '伦理问题',     cls: 'ethics' },
  indifferent: { label: 'Kano 无差别',  cls: 'indiff' },
  low_rice:    { label: 'RICE 太低',    cls: 'lowrice' },
  dependency:  { label: '依赖未满足',   cls: 'depend' },
};

type Stage =
  | { kind: 'idle' }
  | { kind: 'drafting' }
  | {
      kind: 'done';
      list: FeatureList;
      expandedId: string | null;
      kanoFilter: KanoKind | 'all';
      suggestedOnly: boolean;
    };

interface Props {
  projectSlug: string;
  brief: BriefExtraction | null;
  usersContent: CachedUsers | null;
  scenContent: CachedScen | null;
  altContent: AlternativesAnalysis | null;
  initial?: FeatureList;
}

export function FeaturesNode({
  projectSlug,
  brief: briefFromServer,
  usersContent,
  scenContent,
  altContent,
  initial,
}: Props) {
  const router = useRouter();
  const [brief, setBrief] = useState<BriefExtraction | null>(briefFromServer);
  const [cachedBrief, setCachedBrief] = useState<CachedBrief | null>(null);
  const [cachedUsers, setCachedUsers] = useState<CachedUsers | null>(usersContent);
  const [cachedScen, setCachedScen] = useState<CachedScen | null>(scenContent);
  const [cachedAlt, setCachedAlt] = useState<AlternativesAnalysis | null>(altContent);

  useEffect(() => {
    if (!brief) {
      const c = readCache<CachedBrief>(projectSlug, 'brief');
      if (c) {
        setCachedBrief(c);
        setBrief({
          highlights: c.highlights,
          fields: c.fields,
          follow_ups: c.follow_ups,
          completeness: c.completeness,
        });
      }
    }
    if (!cachedUsers) {
      const c = readCache<CachedUsers>(projectSlug, 'users');
      if (c) setCachedUsers(c);
    }
    if (!cachedScen) {
      const c = readCache<CachedScen>(projectSlug, 'scen');
      if (c) setCachedScen(c);
    }
    if (!cachedAlt) {
      const c = readCache<AlternativesAnalysis>(projectSlug, 'alt');
      if (c) setCachedAlt(c);
    }
  }, [brief, cachedUsers, cachedScen, cachedAlt, projectSlug]);

  const [stage, setStage] = useState<Stage>(() =>
    initial
      ? { kind: 'done', list: initial, expandedId: null, kanoFilter: 'all', suggestedOnly: false }
      : { kind: 'idle' },
  );
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();

  useEffect(() => {
    if (stage.kind !== 'idle') return;
    const cached = readCache<FeatureList>(projectSlug, 'feat');
    if (cached && cached.features) {
      setStage({ kind: 'done', list: cached, expandedId: null, kanoFilter: 'all', suggestedOnly: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  const selectedPersonas = useMemo(() => {
    if (!cachedUsers) return [];
    const all = [...cachedUsers.personas, ...(cachedUsers.extraPersonas ?? [])];
    const locked = cachedUsers.personaLocked ?? {};
    return all.filter((p) => locked[p.id]);
  }, [cachedUsers]);

  const lockedJobs = useMemo(() => {
    if (!cachedUsers) return [];
    const locked = cachedUsers.jobLocked ?? {};
    return [
      ...cachedUsers.jobs.functional,
      ...cachedUsers.jobs.emotional,
      ...cachedUsers.jobs.social,
    ].filter((j) => locked[j.id]);
  }, [cachedUsers]);

  const pickedScenarios = useMemo(() => {
    if (!cachedScen?.scenarios || !cachedScen.picked_scenario_ids) return [];
    const ids = new Set(cachedScen.picked_scenario_ids);
    return cachedScen.scenarios.filter((s) => ids.has(s.id));
  }, [cachedScen]);

  const designInsights = cachedScen?.deep?.design_insights ?? [];
  const painPoints = cachedScen?.deep?.pain_points ?? [];

  const hasUpstream = designInsights.length > 0;

  const draft = () => {
    setError(null);
    setStage({ kind: 'drafting' });
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = { projectSlug };
        const preferred = readPreferredModel();
        if (preferred) payload.model = preferred;
        if (cachedBrief) {
          payload.brief = {
            highlights: cachedBrief.highlights,
            fields: cachedBrief.fields,
            follow_ups: cachedBrief.follow_ups,
            completeness: cachedBrief.completeness,
          };
          if (cachedBrief.raw_text) payload.rawText = cachedBrief.raw_text;
          if (cachedBrief.answers) payload.answers = cachedBrief.answers;
        } else if (brief) {
          payload.brief = brief;
        }
        if (selectedPersonas.length > 0) payload.personas = selectedPersonas;
        if (lockedJobs.length > 0) payload.lockedJobs = lockedJobs;
        if (pickedScenarios.length > 0) payload.scenarios = pickedScenarios;
        if (designInsights.length > 0) payload.design_insights = designInsights;
        if (painPoints.length > 0) payload.pain_points = painPoints;
        if (cachedAlt?.differentiation_hypothesis)
          payload.differentiation_hypothesis = cachedAlt.differentiation_hypothesis;

        const res = await fetch('/api/ai/features', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          data?: FeatureList;
          error?: string;
          detail?: string;
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '起草失败');
        }
        writeCache(projectSlug, 'feat', json.data);
        setStage({
          kind: 'done',
          list: json.data,
          expandedId: null,
          kanoFilter: 'all',
          suggestedOnly: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'idle' });
      }
    });
  };

  const toggleExpand = (id: string) => {
    if (stage.kind !== 'done') return;
    setStage({
      ...stage,
      expandedId: stage.expandedId === id ? null : id,
    });
  };

  const togglePriority = (id: string) => {
    if (stage.kind !== 'done') return;
    const nextFeatures = stage.list.features.map((f) =>
      f.id === id ? { ...f, suggested_priority: !f.suggested_priority } : f,
    );
    const nextList = { ...stage.list, features: nextFeatures };
    writeCache(projectSlug, 'feat', nextList);
    setStage({ ...stage, list: nextList });
  };

  const setKanoFilter = (k: KanoKind | 'all') => {
    if (stage.kind !== 'done') return;
    setStage({ ...stage, kanoFilter: k });
  };
  const toggleSuggestedOnly = () => {
    if (stage.kind !== 'done') return;
    setStage({ ...stage, suggestedOnly: !stage.suggestedOnly });
  };

  const copilotCards = useMemo<CopilotCard[]>(() => {
    if (!brief) return [{ tag: 'check', title: '需要 Brief', body: '请先完成上游节点' }];
    if (stage.kind === 'idle') {
      return [
        {
          tag: 'feed',
          title: '准备收口为功能列表',
          body: (
            <>
              §九 要求我把上游所有分析<em>收口成"可执行的假设清单"</em>：
              每个功能必须追溯到<em>设计启发 / Job / 痛点</em>。
              <div style={{ marginTop: 8 }}>
                我会产出 <b>金字塔结构</b> · <b>Kano 五分类</b> · <b>RICE 评分</b> ·{' '}
                <b>五问法</b> · <b>功能卡片（即假设）</b> · <b>不做什么清单</b>。
              </div>
              {!hasUpstream ? (
                <div className="dim" style={{ marginTop: 8, fontSize: 12, color: 'var(--warn)' }}>
                  ⚠ 尚未完成情景节点的设计启发。功能会偏抽象。建议先走完 05 情景。
                </div>
              ) : (
                <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
                  上游已就绪：{designInsights.length} 条设计启发 · {lockedJobs.length} 条锁 Job ·{' '}
                  {selectedPersonas.length} 个 persona
                  {cachedAlt?.differentiation_hypothesis ? ' · 差异化假设已获取' : ''}
                </div>
              )}
            </>
          ),
        },
      ];
    }
    if (stage.kind === 'drafting') {
      return [
        {
          tag: 'feed',
          title: '收口中…',
          body: '把 §5-8 所有产出综合成 pyramids + features + not_doing。通常 90-180 秒。',
        },
      ];
    }
    const redLineCount = stage.list.features.filter((f) => f.red_line_risk).length;
    const suggestedCount = stage.list.features.filter((f) => f.suggested_priority).length;
    const cards: CopilotCard[] = [
      {
        tag: 'feed',
        title: `${stage.list.features.length} 个功能 · ${stage.list.pillars.length} 支柱 · ${suggestedCount} 个建议优先`,
        body: (
          <>
            {redLineCount > 0 ? (
              <div style={{ color: 'var(--danger)', fontWeight: 500, marginBottom: 6 }}>
                ⚠ {redLineCount} 个功能触发了道德红线 —— 必须审查
              </div>
            ) : null}
            差异化假设回响：<em>{stage.list.differentiation_echo}</em>
          </>
        ),
      },
    ];
    for (const c of stage.list.critiques) cards.push({ tag: c.kind, title: c.title, body: c.body });
    return cards;
  }, [stage, brief, hasUpstream, designInsights, lockedJobs, selectedPersonas, cachedAlt]);

  if (!brief) {
    return (
      <div className="main">
        <main className="work">
          <div className="work-inner">
            <NodeHat />
            <h1 className="node-title">功能列表：让每一个功能都有出处</h1>
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-state-title">缺少上游上下文</div>
              <p>
                请先完成{' '}
                <Link href={`/project/${projectSlug}/brief`} style={{ color: 'var(--accent)' }}>Brief</Link>、
                <Link href={`/project/${projectSlug}/users`} style={{ color: 'var(--accent)' }}>用户与任务</Link>{' '}
                和{' '}
                <Link href={`/project/${projectSlug}/scen`} style={{ color: 'var(--accent)' }}>情景分析</Link>。
              </p>
            </div>
          </div>
        </main>
        <Copilot projectSlug={projectSlug} nodeKind="feat" cards={copilotCards} />
      </div>
    );
  }

  return (
    <div className="main">
      <main className="work wide">
        <div className="work-inner">
          <NodeHat chip={stageChip(stage)} />
          <h1 className="node-title">功能列表：让每一个功能都有出处</h1>
          <p className="node-intro">
            §九 要求把前面所有分析<em>收口</em>成"可执行的假设清单"。
            我会产出<em>金字塔结构</em>、<em>Kano 五分类</em>、<em>RICE 评分</em>、
            <em>五问法</em>、<em>功能卡片即假设</em>、以及<em>不做什么清单</em>。
            每个功能都带来源追溯。
          </p>

          <UpstreamStatus
            insights={designInsights.length}
            jobs={lockedJobs.length}
            personas={selectedPersonas.length}
            scenarios={pickedScenarios.length}
            diffHypothesis={cachedAlt?.differentiation_hypothesis}
          />

          {stage.kind === 'idle' ? (
            <div className="para-section" style={{ display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="btn btn-accent" onClick={draft}>
                基于上游产出起草功能列表 →
              </button>
            </div>
          ) : null}

          {stage.kind === 'drafting' ? (
            <div className="para-section">
              <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                <span className="ai-spinner" />
                &nbsp; 收口中 · 同时计算 Kano/RICE/五问法/功能卡片，通常 90-180 秒……
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="cop-card" style={{ marginTop: 14, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
              <div className="cop-card-title">调用失败</div>
              <div className="cop-card-body" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{error}</div>
            </div>
          ) : null}

          {stage.kind === 'done' ? (
            <>
              {/* § 1 金字塔支柱 */}
              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">金字塔支柱</span>
                  <span className="para-h-hint">
                    {stage.list.pillars.length} 个 · §9.1 同层 ≤ 7
                  </span>
                </div>
                <PillarsStrip pillars={stage.list.pillars} features={stage.list.features} />
              </div>

              {/* § 2 功能清单（过滤器 + 卡片） */}
              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">功能清单</span>
                  <span className="para-h-hint">
                    点卡片展开五问法 + 功能卡片
                  </span>
                </div>
                <FeatureFilters
                  kanoFilter={stage.kanoFilter}
                  suggestedOnly={stage.suggestedOnly}
                  features={stage.list.features}
                  onKanoChange={setKanoFilter}
                  onSuggestedToggle={toggleSuggestedOnly}
                />
                <FeaturePyramid
                  pillars={stage.list.pillars}
                  features={stage.list.features}
                  kanoFilter={stage.kanoFilter}
                  suggestedOnly={stage.suggestedOnly}
                  expandedId={stage.expandedId}
                  onExpand={toggleExpand}
                  onPriorityToggle={togglePriority}
                  scenarios={pickedScenarios}
                  jobs={lockedJobs}
                  insights={designInsights}
                />
              </div>

              {/* § 3 不做什么 */}
              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">不做什么（§9.6）</span>
                  <span className="para-h-hint">
                    {stage.list.not_doing.length} 条 · 防止范围蔓延
                  </span>
                </div>
                <NotDoingList items={stage.list.not_doing} />
              </div>

              {/* § 4 差异化回响 */}
              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">差异化假设回响</span>
                  <span className="para-h-hint">
                    §七 → §九 的对账
                  </span>
                </div>
                <div className="diff-echo">
                  <div className="diff-echo-quote">{stage.list.differentiation_echo}</div>
                </div>
              </div>

              <div className="para-section" style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => {
                    const next = nextNodeKind('feat');
                    if (next) router.push(`/project/${projectSlug}/${next}`);
                  }}
                >
                  {(() => {
                    const n = nextNodeKind('feat');
                    const node = n ? getNode(n) : null;
                    return node ? `继续 · ${node.num} ${node.label} →` : '继续 →';
                  })()}
                </button>
                <button type="button" className="btn btn-ghost" onClick={draft}>
                  重新起草
                </button>
              </div>
            </>
          ) : null}
        </div>
      </main>

      <Copilot projectSlug={projectSlug} nodeKind="feat" cards={copilotCards} pending={stage.kind === 'drafting'}
        extraSlot={stage.kind === 'done' ? <NodeFollowUpsSection projectSlug={projectSlug} nodeKind="feat" content={(stage.list) as unknown as Record<string, unknown>} /> : null}
      />
    </div>
  );
}

function NodeHat({ chip }: { chip?: string } = {}) {
  return (
    <div className="node-hat">
      <span className="node-hat-num">{formatNodeNum('feat')}</span>
      <span className="node-hat-rule" />
      <span className="node-hat-chip">{chip ?? '功能列表 · 预计 45 分钟'}</span>
    </div>
  );
}

function stageChip(stage: Stage): string {
  if (stage.kind === 'idle') return '功能列表 · 预计 45 分钟';
  if (stage.kind === 'drafting') return '收口中…';
  return '已起草 · 可调整';
}

function UpstreamStatus({
  insights,
  jobs,
  personas,
  scenarios,
  diffHypothesis,
}: {
  insights: number;
  jobs: number;
  personas: number;
  scenarios: number;
  diffHypothesis?: string;
}) {
  const items = [
    { label: '设计启发', count: insights, need: true },
    { label: '锁定 Job', count: jobs, need: true },
    { label: 'persona', count: personas, need: true },
    { label: '深入情景', count: scenarios, need: false },
    { label: '差异化假设', count: diffHypothesis ? 1 : 0, need: false },
  ];
  return (
    <div className="para-section">
      <div className="upstream-status">
        {items.map((it) => (
          <div key={it.label} className={`upstream-chip ${it.count === 0 && it.need ? 'warn' : it.count > 0 ? 'ok' : 'dim'}`}>
            <span className="upstream-chip-label">{it.label}</span>
            <span className="upstream-chip-count">{it.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PillarsStrip({
  pillars,
  features,
}: {
  pillars: Pillar[];
  features: Feature[];
}) {
  return (
    <div className="pillar-strip">
      {pillars.map((p) => {
        const count = features.filter((f) => f.pillar === p.id || f.pillar === p.name).length;
        return (
          <div key={p.id} className="pillar-card">
            <div className="pillar-name">{p.name}</div>
            <div className="pillar-desc">{p.description}</div>
            <div className="pillar-count">{count} 个功能</div>
          </div>
        );
      })}
    </div>
  );
}

function FeatureFilters({
  kanoFilter,
  suggestedOnly,
  features,
  onKanoChange,
  onSuggestedToggle,
}: {
  kanoFilter: KanoKind | 'all';
  suggestedOnly: boolean;
  features: Feature[];
  onKanoChange: (k: KanoKind | 'all') => void;
  onSuggestedToggle: () => void;
}) {
  const counts: Record<KanoKind | 'all', number> = {
    all: features.length,
    must: 0, performance: 0, delight: 0, indifferent: 0, reverse: 0,
  };
  for (const f of features) counts[f.kano]++;
  return (
    <div className="feature-filters">
      {KANO_FILTER_KEYS.map((k) => {
        const isAll = k === 'all';
        const meta = isAll ? null : KANO_META[k as KanoKind];
        return (
          <button
            key={k}
            type="button"
            className={`kano-pill ${isAll ? 'all' : meta!.cls} ${kanoFilter === k ? 'on' : ''}`}
            onClick={() => onKanoChange(k)}
          >
            {isAll ? '全部' : meta!.short}
            <span className="kano-count">{counts[k]}</span>
          </button>
        );
      })}
      <div style={{ flex: 1 }} />
      <label className="suggested-toggle">
        <input
          type="checkbox"
          checked={suggestedOnly}
          onChange={onSuggestedToggle}
        />
        <span>仅显示 AI 建议优先</span>
      </label>
    </div>
  );
}

function FeaturePyramid({
  pillars,
  features,
  kanoFilter,
  suggestedOnly,
  expandedId,
  onExpand,
  onPriorityToggle,
  scenarios,
  jobs,
  insights,
}: {
  pillars: Pillar[];
  features: Feature[];
  kanoFilter: KanoKind | 'all';
  suggestedOnly: boolean;
  expandedId: string | null;
  onExpand: (id: string) => void;
  onPriorityToggle: (id: string) => void;
  scenarios: ScenarioDraft[];
  jobs: Job[];
  insights: ScenarioDeepAnalysis['design_insights'];
}) {
  const filtered = features.filter((f) => {
    if (kanoFilter !== 'all' && f.kano !== kanoFilter) return false;
    if (suggestedOnly && !f.suggested_priority) return false;
    return true;
  });
  const byPillar = new Map<string, Feature[]>();
  for (const p of pillars) byPillar.set(p.id, []);
  for (const f of filtered) {
    const pillarId = pillars.find((p) => p.id === f.pillar || p.name === f.pillar)?.id ?? f.pillar;
    const arr = byPillar.get(pillarId) ?? [];
    arr.push(f);
    byPillar.set(pillarId, arr);
  }

  const scenarioById = new Map(scenarios.map((s) => [s.id, s]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));
  const insightById = new Map(insights.map((i) => [i.id, i]));

  return (
    <div className="feature-pyramid">
      {pillars.map((p) => {
        const items = byPillar.get(p.id) ?? [];
        if (items.length === 0 && (kanoFilter !== 'all' || suggestedOnly)) return null;
        const sorted = [...items].sort((a, b) => b.rice_score - a.rice_score);
        return (
          <div key={p.id} className="pillar-section">
            <div className="pillar-section-head">
              <span className="pillar-section-name">{p.name}</span>
              <span className="pillar-section-desc">{p.description}</span>
              <span className="pillar-section-count">{items.length} 个</span>
            </div>
            <div className="feature-list-v2">
              {sorted.map((f) => (
                <FeatureCard
                  key={f.id}
                  feature={f}
                  expanded={expandedId === f.id}
                  onExpand={() => onExpand(f.id)}
                  onPriorityToggle={() => onPriorityToggle(f.id)}
                  scenarioById={scenarioById}
                  jobById={jobById}
                  insightById={insightById}
                />
              ))}
              {items.length === 0 ? (
                <div className="dim" style={{ fontStyle: 'italic', padding: '10px 0', fontSize: 12 }}>
                  此支柱下没有符合过滤器的功能
                </div>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeatureCard({
  feature: f,
  expanded,
  onExpand,
  onPriorityToggle,
  scenarioById,
  jobById,
  insightById,
}: {
  feature: Feature;
  expanded: boolean;
  onExpand: () => void;
  onPriorityToggle: () => void;
  scenarioById: Map<string, ScenarioDraft>;
  jobById: Map<string, Job>;
  insightById: Map<string, ScenarioDeepAnalysis['design_insights'][number]>;
}) {
  const kanoMeta = KANO_META[f.kano];
  return (
    <div className={`feature-v2 kano-${kanoMeta.cls} ${expanded ? 'expanded' : ''} ${f.red_line_risk ? 'red-line' : ''}`}>
      <div className="feature-v2-head">
        <button
          type="button"
          className={`priority-star ${f.suggested_priority ? 'on' : ''}`}
          onClick={onPriorityToggle}
          title={f.suggested_priority ? '取消优先' : '标为优先'}
        >
          {f.suggested_priority ? '★' : '☆'}
        </button>
        <button
          type="button"
          className="feature-v2-main"
          onClick={onExpand}
        >
          <div className="feature-v2-top">
            <span className={`kano-pill inline ${kanoMeta.cls}`} title={kanoMeta.hint}>
              {kanoMeta.short}
            </span>
            <span className="feature-v2-name">{f.name}</span>
            {f.red_line_risk ? (
              <span className="red-line-flag">⚠ 红线</span>
            ) : null}
            <span className="feature-v2-rice">RICE {f.rice_score}</span>
          </div>
          <div className="feature-v2-desc">{f.description}</div>
        </button>
      </div>

      {expanded ? (
        <div className="feature-v2-detail">
          <div className="detail-row">
            <div className="detail-label">RICE 拆解</div>
            <div className="detail-value">
              <span className="rice-cell">R {f.rice.reach}</span>
              <span className="rice-sep">×</span>
              <span className="rice-cell">I {f.rice.impact}</span>
              <span className="rice-sep">×</span>
              <span className="rice-cell">C {f.rice.confidence}</span>
              <span className="rice-sep">÷</span>
              <span className="rice-cell">E {f.rice.effort}</span>
              <span className="rice-sep">=</span>
              <span className="rice-cell final">{f.rice_score}</span>
            </div>
          </div>

          <div className="detail-row">
            <div className="detail-label">§9.4 五问法</div>
            <div className="detail-value five-q-list">
              <FiveQItem label="Q1 为什么做" text={f.five_questions.why_do} />
              <FiveQItem label="Q2 为什么这么做" text={f.five_questions.why_this_way} />
              <FiveQItem label="Q3 还能怎么做" text={f.five_questions.alternatives} />
              <FiveQItem label="Q4 不做会怎样" text={f.five_questions.what_if_not} />
              <FiveQItem
                label="Q5 ★ 做错会怎样"
                text={f.five_questions.what_if_wrong}
                accent
              />
            </div>
          </div>

          <div className="detail-row">
            <div className="detail-label">§9.5 功能卡片 = 假设</div>
            <div className="detail-value hypothesis-card">
              <div className="hyp-item">
                <span className="hyp-label">核心假设</span>
                <span>{f.core_hypothesis}</span>
              </div>
              <div className="hyp-item">
                <span className="hyp-label">验证指标</span>
                <span>{f.validation_metric}</span>
              </div>
              <div className="hyp-item">
                <span className="hyp-label">失败信号</span>
                <span style={{ color: 'var(--danger)' }}>{f.failure_signal}</span>
              </div>
            </div>
          </div>

          {f.ethics_concern ? (
            <div className="detail-row">
              <div className="detail-label">伦理前哨</div>
              <div className="detail-value ethics-warn">
                ⚠ {f.ethics_concern}
                <div className="dim" style={{ fontSize: 11, marginTop: 4 }}>
                  完整七问审查会在 §十一 伦理审查节点进行
                </div>
              </div>
            </div>
          ) : null}

          {(f.traces.insight_ids.length > 0 ||
            f.traces.job_ids.length > 0 ||
            f.traces.scenario_ids.length > 0) ? (
            <div className="detail-row">
              <div className="detail-label">来源追溯</div>
              <div className="detail-value traces">
                {f.traces.insight_ids.map((id) => {
                  const i = insightById.get(id);
                  return (
                    <span key={id} className="trace-chip insight" title={i?.insight_text}>
                      启发 · {i ? i.action.slice(0, 20) : id}
                    </span>
                  );
                })}
                {f.traces.job_ids.map((id) => {
                  const j = jobById.get(id);
                  return (
                    <span key={id} className="trace-chip job">
                      Job · {j ? j.title.slice(0, 20) : id}
                    </span>
                  );
                })}
                {f.traces.scenario_ids.map((id) => {
                  const s = scenarioById.get(id);
                  return (
                    <span key={id} className="trace-chip scen">
                      情景 · {s ? s.title : id}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FiveQItem({ label, text, accent }: { label: string; text: string; accent?: boolean }) {
  return (
    <div className={`five-q ${accent ? 'accent' : ''}`}>
      <div className="five-q-label">{label}</div>
      <div className="five-q-text">{text}</div>
    </div>
  );
}

function NotDoingList({ items }: { items: NotDoing[] }) {
  return (
    <div className="not-doing-list">
      {items.map((it, i) => {
        const meta = NOT_DOING_REASON[it.reason];
        return (
          <div key={i} className={`not-doing-item reason-${meta.cls}`}>
            <div className="not-doing-head">
              <span className="not-doing-name">{it.name}</span>
              <span className={`not-doing-reason reason-${meta.cls}`}>{meta.label}</span>
            </div>
            <div className="not-doing-why">{it.why}</div>
          </div>
        );
      })}
    </div>
  );
}
