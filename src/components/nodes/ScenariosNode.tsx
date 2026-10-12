'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { NodeFollowUpsSection } from '@/components/shared/NodeFollowUpsSection';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/schemas/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/schemas/analyze-users';
import {
  DIMENSION_KEYS,
  DIMENSION_META,
  type DimensionKey,
  type DimensionsResult,
  type ScenarioDraft,
  type ScenarioDeepAnalysis,
  type ScenarioElement,
} from '@/lib/ai/schemas/analyze-scenarios';
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

type Stage =
  | { kind: 'idle' }
  | { kind: 'exhausting' }
  | { kind: 'dimensions'; dimensions: DimensionsResult; selected: Record<string, boolean> }
  | { kind: 'combining'; dimensions: DimensionsResult; selected: Record<string, boolean> }
  | {
      kind: 'scenarios';
      dimensions: DimensionsResult;
      selectedElements: Record<string, boolean>;
      scenarios: ScenarioDraft[];
      pickedScenarios: Record<string, boolean>;
    }
  | {
      kind: 'deepening';
      dimensions: DimensionsResult;
      selectedElements: Record<string, boolean>;
      scenarios: ScenarioDraft[];
      pickedScenarios: Record<string, boolean>;
    }
  | {
      kind: 'done';
      dimensions: DimensionsResult;
      selectedElements: Record<string, boolean>;
      scenarios: ScenarioDraft[];
      pickedScenarios: Record<string, boolean>;
      deep: ScenarioDeepAnalysis;
    };

interface Props {
  projectSlug: string;
  brief: BriefExtraction | null;
  usersContent: CachedUsers | null;
  initial?: {
    scenarios?: ScenarioDraft[];
    picked_scenario_ids?: string[];
    deep?: ScenarioDeepAnalysis;
  };
}

const CATEGORY_LABEL: Record<'core' | 'safety_net' | 'fringe', string> = {
  core: '核心',
  safety_net: '安全网',
  fringe: '边缘',
};

export function ScenariosNode({
  projectSlug,
  brief: briefFromServer,
  usersContent,
  initial,
}: Props) {
  const router = useRouter();
  const [brief, setBrief] = useState<BriefExtraction | null>(briefFromServer);
  const [cachedBrief, setCachedBrief] = useState<CachedBrief | null>(null);
  const [cachedUsers, setCachedUsers] = useState<CachedUsers | null>(usersContent);

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
  }, [brief, cachedUsers, projectSlug]);

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

  const [stage, setStage] = useState<Stage>(() => {
    if (initial?.deep && initial.scenarios && initial.picked_scenario_ids) {
      const pickedSet: Record<string, boolean> = {};
      for (const id of initial.picked_scenario_ids) pickedSet[id] = true;
      return {
        kind: 'done',
        dimensions: {
          dimensions: Object.fromEntries(
            DIMENSION_KEYS.map((k) => [k, [] as ScenarioElement[]]),
          ) as DimensionsResult['dimensions'],
        },
        selectedElements: {},
        scenarios: initial.scenarios,
        pickedScenarios: pickedSet,
        deep: initial.deep,
      };
    }
    return { kind: 'idle' };
  });
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();

  useEffect(() => {
    if (stage.kind !== 'idle') return;
    const cached = readCache<Extract<Stage, { kind: 'done' }>>(projectSlug, 'scen-ui');
    if (cached && cached.kind === 'done') setStage(cached);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  const persist = (next: Stage) => {
    if (next.kind === 'done') {
      writeCache(projectSlug, 'scen-ui', next);
      writeCache(projectSlug, 'scen', {
        scenarios: next.scenarios,
        picked_scenario_ids: Object.keys(next.pickedScenarios).filter((k) => next.pickedScenarios[k]),
        deep: next.deep,
      });
    }
  };

  const buildCtxPayload = (): Record<string, unknown> => {
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
    return payload;
  };

  const runExhaust = () => {
    setError(null);
    setStage({ kind: 'exhausting' });
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/scenarios', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'exhaust', ...buildCtxPayload() }),
        });
        const json = (await res.json()) as { ok?: boolean; data?: DimensionsResult; error?: string; detail?: string };
        if (!res.ok || !json.ok || !json.data) throw new Error(json.detail ?? json.error ?? '穷举失败');
        // Auto-pick all 'high' relevance items as starter selection
        const selected: Record<string, boolean> = {};
        for (const key of DIMENSION_KEYS) {
          for (const e of json.data.dimensions[key]) {
            if (e.relevance === 'high') selected[e.id] = true;
          }
        }
        setStage({ kind: 'dimensions', dimensions: json.data, selected });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'idle' });
      }
    });
  };

  const toggleElement = (id: string) => {
    if (stage.kind !== 'dimensions') return;
    setStage({
      ...stage,
      selected: { ...stage.selected, [id]: !stage.selected[id] },
    });
  };

  const runCombine = () => {
    if (stage.kind !== 'dimensions') return;
    const selectedIds = Object.keys(stage.selected).filter((k) => stage.selected[k]);
    if (selectedIds.length < 3) {
      setError('至少勾选 3 个要素才能组合情景');
      return;
    }
    setError(null);
    const prev = stage;
    setStage({ kind: 'combining', dimensions: prev.dimensions, selected: prev.selected });
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/scenarios', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'combine',
            ...buildCtxPayload(),
            dimensions: prev.dimensions,
            selectedElementIds: selectedIds,
          }),
        });
        const json = (await res.json()) as { ok?: boolean; data?: { scenarios: ScenarioDraft[] }; error?: string; detail?: string };
        if (!res.ok || !json.ok || !json.data) throw new Error(json.detail ?? json.error ?? '组合失败');
        setStage({
          kind: 'scenarios',
          dimensions: prev.dimensions,
          selectedElements: prev.selected,
          scenarios: json.data.scenarios,
          pickedScenarios: {},
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage(prev);
      }
    });
  };

  const togglePickScenario = (id: string) => {
    if (stage.kind !== 'scenarios') return;
    const next = { ...stage.pickedScenarios, [id]: !stage.pickedScenarios[id] };
    const count = Object.values(next).filter(Boolean).length;
    if (count > 3) {
      setError('最多深入 3 个情景');
      return;
    }
    setError(null);
    setStage({ ...stage, pickedScenarios: next });
  };

  const runDeep = () => {
    if (stage.kind !== 'scenarios') return;
    const pickedIds = Object.keys(stage.pickedScenarios).filter((k) => stage.pickedScenarios[k]);
    if (pickedIds.length === 0) {
      setError('至少选 1 个情景深入');
      return;
    }
    setError(null);
    const prev = stage;
    setStage({ ...stage, kind: 'deepening' });
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/scenarios', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            action: 'deep',
            ...buildCtxPayload(),
            scenarios: prev.scenarios,
            pickedScenarioIds: pickedIds,
          }),
        });
        const json = (await res.json()) as { ok?: boolean; data?: ScenarioDeepAnalysis; error?: string; detail?: string };
        if (!res.ok || !json.ok || !json.data) throw new Error(json.detail ?? json.error ?? '深度分析失败');
        const next: Extract<Stage, { kind: 'done' }> = {
          kind: 'done',
          dimensions: prev.dimensions,
          selectedElements: prev.selectedElements,
          scenarios: prev.scenarios,
          pickedScenarios: prev.pickedScenarios,
          deep: json.data,
        };
        persist(next);
        setStage(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage(prev);
      }
    });
  };

  const reset = () => {
    setError(null);
    setStage({ kind: 'idle' });
  };

  const copilotCards = useMemo<CopilotCard[]>(() => {
    if (!brief) return [{ tag: 'check', title: '需要 Brief', body: '请先完成 Brief 节点' }];
    if (stage.kind === 'idle') {
      return [
        {
          tag: 'feed',
          title: '§八 情景分析的流水线',
          body: (
            <>
              三步走：<em>7 维穷举候选</em>（AI）→ <em>你勾选要素</em> → <em>AI 组合出情景</em> →
              <em>你选 3 个深入</em> → AI 一次产出矩阵/极值/敌意/痛快点/设计启发。
            </>
          ),
        },
      ];
    }
    if (stage.kind === 'exhausting') {
      return [{ tag: 'feed', title: '穷举 7 维要素…', body: '每维 8-12 个候选，通常 30-60 秒' }];
    }
    if (stage.kind === 'dimensions') {
      const count = Object.values(stage.selected).filter(Boolean).length;
      return [
        {
          tag: 'ask',
          title: `已选 ${count} 个要素`,
          body: (
            <>
              AI 自动帮你勾上了"高相关"候选。
              <em>快速扫一遍</em>，加勾漏掉的、取消不相关的，然后点下一步让我组合情景。
              <div className="dim" style={{ marginTop: 6, fontSize: 12 }}>
                方法论要求"先发散再收敛"——多选几个没关系，少选容易漏。
              </div>
            </>
          ),
        },
      ];
    }
    if (stage.kind === 'combining') {
      return [{ tag: 'feed', title: '组合情景中…', body: '基于你选的要素交叉组合 5-8 个具体情景' }];
    }
    if (stage.kind === 'scenarios') {
      const pickedCount = Object.values(stage.pickedScenarios).filter(Boolean).length;
      return [
        {
          tag: 'ask',
          title: `选 3 个最值得深入的情景（已选 ${pickedCount} / 3）`,
          body: (
            <>
              方法论建议选<em>覆盖差异最大</em>的 3 个——例如"独自" + "家长在旁" + "考前"三类互斥状态。
              深入会产出：矩阵、极值、敌意、痛点根因、设计启发。
            </>
          ),
        },
      ];
    }
    if (stage.kind === 'deepening') {
      return [
        { tag: 'feed', title: '深度分析中…', body: '同时计算矩阵 + 极值 + 敌意 + 痛快点 + 设计启发，通常 60-120 秒' },
      ];
    }
    // done
    const cards: CopilotCard[] = [
      {
        tag: 'feed',
        title: `深度分析完成 · ${stage.deep.design_insights.length} 条设计启发`,
        body: (
          <>
            覆盖 <b>{stage.deep.extremes.length} 个极值情景</b> · <b>{stage.deep.hostiles.length} 个敌意情景</b> · <b>{stage.deep.pain_points.length} 个痛点（连续追问 3 层）</b>。
          </>
        ),
      },
    ];
    for (const c of stage.deep.critiques) cards.push({ tag: c.kind, title: c.title, body: c.body });
    return cards;
  }, [stage, brief]);

  if (!brief) {
    return (
      <div className="main">
        <main className="work">
          <div className="work-inner">
            <NodeHat />
            <h1 className="node-title">情景分析：把用户的世界拆开看</h1>
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-state-title">缺少 Brief 上下文</div>
              <p>
                请先完成{' '}
                <Link href={`/project/${projectSlug}/brief`} style={{ color: 'var(--accent)' }}>Brief</Link>{' '}
                和{' '}
                <Link href={`/project/${projectSlug}/users`} style={{ color: 'var(--accent)' }}>用户与任务</Link>
                。
              </p>
            </div>
          </div>
        </main>
        <Copilot projectSlug={projectSlug} nodeKind="scen" cards={copilotCards} />
      </div>
    );
  }

  return (
    <div className="main">
      <main className="work wide">
        <div className="work-inner">
          <NodeHat chip={stageChip(stage)} />
          <h1 className="node-title">情景分析：挖真需求最锋利的工具</h1>
          <p className="node-intro">
            按 §八 方法论：<em>7 维穷举要素 → 组合具体情景 → 3 个深入</em>。
            产出包括情景×Job 矩阵、极值情景、敌意情景、痛点连续追问到根因、
            以及固定格式的设计启发（"在 X 下，Y 想完成 Z，因此我们可以 D"）。
          </p>

          <Progress stage={stage} />

          {/* Stage 1 idle */}
          {stage.kind === 'idle' ? (
            <div className="para-section" style={{ display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="btn btn-accent" onClick={runExhaust}>
                第一步：穷举 7 维要素 →
              </button>
            </div>
          ) : null}

          {stage.kind === 'exhausting' ? <Spinner text="穷举中 · 每维 8-12 个候选" /> : null}

          {/* Stage 2: dimensions checkboxes */}
          {stage.kind === 'dimensions' || stage.kind === 'combining' ? (
            <div className="para-section">
              <div className="para-h">

                <span className="para-h-title">7 维要素穷举</span>
                <span className="para-h-hint">
                  已选 {Object.values(stage.selected).filter(Boolean).length} · 方法论要求"先发散再收敛"
                </span>
              </div>
              <DimensionsGrid
                dimensions={stage.dimensions}
                selected={stage.selected}
                onToggle={toggleElement}
                readOnly={stage.kind === 'combining'}
              />
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button type="button" className="btn btn-ghost" onClick={runExhaust} disabled={stage.kind === 'combining'}>
                  重新穷举
                </button>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={runCombine}
                  disabled={stage.kind === 'combining'}
                >
                  {stage.kind === 'combining' ? (
                    <>
                      <span className="ai-spinner" />
                      &nbsp; 组合情景中
                    </>
                  ) : (
                    '第二步：AI 组合情景 →'
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {/* Stage 3: scenarios picker */}
          {stage.kind === 'scenarios' || stage.kind === 'deepening' ? (
            <div className="para-section">
              <div className="para-h">

                <span className="para-h-title">具体情景（选 3 个深入）</span>
                <span className="para-h-hint">
                  {stage.scenarios.length} 个候选 · 已选 {Object.values(stage.pickedScenarios).filter(Boolean).length} / 3
                </span>
              </div>
              <ScenariosGrid
                scenarios={stage.scenarios}
                picked={stage.pickedScenarios}
                onToggle={togglePickScenario}
                readOnly={stage.kind === 'deepening'}
              />
              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={stage.kind === 'deepening'}
                  onClick={() =>
                    setStage({
                      kind: 'dimensions',
                      dimensions: stage.dimensions,
                      selected: stage.selectedElements,
                    })
                  }
                >
                  ← 回上一步
                </button>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={runDeep}
                  disabled={stage.kind === 'deepening'}
                >
                  {stage.kind === 'deepening' ? (
                    <>
                      <span className="ai-spinner" />
                      &nbsp; 深度分析中
                    </>
                  ) : (
                    '第三步：深度分析 →'
                  )}
                </button>
              </div>
            </div>
          ) : null}

          {/* Done: show 5 deliverables */}
          {stage.kind === 'done' ? <DoneDeliverables stage={stage} jobs={lockedJobs} /> : null}

          {error ? (
            <div
              className="cop-card"
              style={{ marginTop: 14, borderColor: 'var(--danger)', color: 'var(--danger)' }}
            >
              <div className="cop-card-title">提示</div>
              <div className="cop-card-body" style={{ fontSize: 12 }}>
                {error}
              </div>
            </div>
          ) : null}

          {stage.kind === 'done' ? (
            <div className="para-section" style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn btn-accent"
                onClick={() => {
                  const next = nextNodeKind('scen');
                  if (next) router.push(`/project/${projectSlug}/${next}`);
                }}
              >
                继续 · 06 功能列表 →
              </button>
              <button type="button" className="btn btn-ghost" onClick={reset}>
                全部重新来
              </button>
            </div>
          ) : null}
        </div>
      </main>

      <Copilot projectSlug={projectSlug} nodeKind="scen" cards={copilotCards} pending={['exhausting', 'combining', 'deepening'].includes(stage.kind)}
        extraSlot={stage.kind === 'done' ? <NodeFollowUpsSection projectSlug={projectSlug} nodeKind="scen" content={({ scenarios: stage.scenarios, picked_scenario_ids: Object.keys(stage.pickedScenarios).filter((k) => stage.pickedScenarios[k]), deep: stage.deep }) as unknown as Record<string, unknown>} /> : null}
      />
    </div>
  );
}

function NodeHat({ chip }: { chip?: string } = {}) {
  return (
    <div className="node-hat">
      <span className="node-hat-num">{formatNodeNum('scen')}</span>
      <span className="node-hat-rule" />
      <span className="node-hat-chip">{chip ?? '情景分析 · 预计 30 分钟'}</span>
    </div>
  );
}

function stageChip(stage: Stage): string {
  switch (stage.kind) {
    case 'idle':       return '情景分析 · 预计 30 分钟';
    case 'exhausting': return '穷举 7 维要素…';
    case 'dimensions': return '勾选要素 · 请快速扫';
    case 'combining':  return '组合情景中…';
    case 'scenarios':  return '选 3 个情景深入';
    case 'deepening':  return '深度分析中…';
    case 'done':       return '已分析 · 5 份产出';
  }
}

function Progress({ stage }: { stage: Stage }) {
  const steps: { key: Stage['kind'][]; label: string }[] = [
    { key: ['exhausting', 'dimensions', 'combining'], label: '1 · 穷举' },
    { key: ['combining', 'scenarios', 'deepening'], label: '2 · 组合' },
    { key: ['scenarios', 'deepening'], label: '3 · 选 3 个' },
    { key: ['deepening', 'done'], label: '4 · 深度分析' },
    { key: ['done'], label: '完成' },
  ];
  const activeIdx = steps.findIndex((s) => s.key.includes(stage.kind));
  return (
    <div className="scen-progress">
      {steps.map((s, i) => {
        const past = i < activeIdx;
        const active = i === activeIdx;
        return (
          <div key={i} className={`scen-step ${past ? 'past' : ''} ${active ? 'active' : ''}`}>
            <span className="scen-step-dot">{past ? '✓' : i + 1}</span>
            <span className="scen-step-label">{s.label}</span>
          </div>
        );
      })}
    </div>
  );
}

function Spinner({ text }: { text: string }) {
  return (
    <div className="para-section">
      <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
        <span className="ai-spinner" />
        &nbsp; {text}
      </div>
    </div>
  );
}

function DimensionsGrid({
  dimensions,
  selected,
  onToggle,
  readOnly,
}: {
  dimensions: DimensionsResult;
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
  readOnly: boolean;
}) {
  return (
    <div className="scen-dim-list">
      {DIMENSION_KEYS.map((k) => {
        const meta = DIMENSION_META[k];
        const items = dimensions.dimensions[k];
        const pickedCount = items.filter((e) => selected[e.id]).length;
        return (
          <div key={k} className="scen-dim-row">
            <div className="scen-dim-head">
              <div>
                <span className="scen-dim-label">{meta.label}</span>
                <span className="scen-dim-hint">{meta.hint}</span>
              </div>
              <span className="scen-dim-count">{pickedCount} / {items.length}</span>
            </div>
            <div className="scen-dim-items">
              {items.map((e) => (
                <button
                  type="button"
                  key={e.id}
                  className={`scen-elem rel-${e.relevance} ${selected[e.id] ? 'on' : ''}`}
                  onClick={() => !readOnly && onToggle(e.id)}
                  disabled={readOnly}
                  title={`相关度：${e.relevance}`}
                >
                  {selected[e.id] ? '✓ ' : ''}
                  {e.text}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ScenariosGrid({
  scenarios,
  picked,
  onToggle,
  readOnly,
}: {
  scenarios: ScenarioDraft[];
  picked: Record<string, boolean>;
  onToggle: (id: string) => void;
  readOnly: boolean;
}) {
  return (
    <div className="scen-cards">
      {scenarios.map((s, i) => (
        <button
          type="button"
          key={s.id}
          className={`scen-card ${picked[s.id] ? 'picked' : ''}`}
          onClick={() => !readOnly && onToggle(s.id)}
          disabled={readOnly}
        >
          <div className="scen-card-head">
            <span className="scen-card-num">{String(i + 1).padStart(2, '0')}</span>
            <span className="scen-card-title">{s.title}</span>
            {picked[s.id] ? <span className="scen-card-pick">✓ 已选</span> : null}
          </div>
          <div className="scen-card-meta">{s.meta}</div>
          <div className="scen-card-body">{s.narrative}</div>
          <div className="scen-card-hint">
            <b>隐约的不对劲：</b>
            {s.pain_hint}
          </div>
        </button>
      ))}
    </div>
  );
}

function DoneDeliverables({
  stage,
  jobs,
}: {
  stage: Extract<Stage, { kind: 'done' }>;
  jobs: Job[];
}) {
  const pickedIds = Object.keys(stage.pickedScenarios).filter((k) => stage.pickedScenarios[k]);
  const pickedScenarios = stage.scenarios.filter((s) => pickedIds.includes(s.id));
  const scenarioById = new Map(stage.scenarios.map((s) => [s.id, s]));
  const jobById = new Map(jobs.map((j) => [j.id, j]));

  return (
    <>
      {/* 矩阵 */}
      <div className="para-section">
        <div className="para-h">

          <span className="para-h-title">情景 × Job 矩阵</span>
          <span className="para-h-hint">
            §8.2 · 核心格 / 安全网 / 边缘 三类
          </span>
        </div>
        <ScenarioJobMatrix
          pickedScenarios={pickedScenarios}
          jobs={jobs}
          cells={stage.deep.matrix}
        />
      </div>

      {/* 痛点连续追问 */}
      <div className="para-section">
        <div className="para-h">

          <span className="para-h-title">痛点 · 连续追问到根因</span>
          <span className="para-h-hint">§8.4 · 反问 3 层"为什么"</span>
        </div>
        <div className="pain-list">
          {stage.deep.pain_points.map((p) => {
            const s = scenarioById.get(p.scenario_id);
            return (
              <div key={p.id} className="pain-card">
                <div className="pain-head">
                  <span className="pain-moment">{p.moment}</span>
                  <span className="pain-feeling">{p.feeling}</span>
                  {s ? <span className="pain-scen">← {s.title}</span> : null}
                </div>
                <div className="pain-chain">
                  <div className="pain-why">
                    <span className="pain-why-label">为什么？</span>
                    <span>{p.why_1}</span>
                  </div>
                  <div className="pain-why">
                    <span className="pain-why-label">为什么？</span>
                    <span>{p.why_2}</span>
                  </div>
                  <div className="pain-why">
                    <span className="pain-why-label">为什么？</span>
                    <span>{p.why_3}</span>
                  </div>
                  <div className="pain-root">
                    <span className="pain-root-label">底层根因</span>
                    {p.root_cause}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {stage.deep.delight_points.length > 0 ? (
          <>
            <div className="para-h" style={{ marginTop: 22 }}>
              <span className="para-h-title">快点 · 产品的情感机会</span>
              <span className="para-h-hint">{stage.deep.delight_points.length} 个</span>
            </div>
            <div className="delight-list">
              {stage.deep.delight_points.map((d) => (
                <div key={d.id} className="delight-card">
                  <div className="delight-head">
                    <span className="delight-moment">{d.moment}</span>
                    <span className="delight-feeling">{d.feeling}</span>
                  </div>
                  <div className="delight-reason">
                    <b>真正打动的是：</b>
                    {d.root_reason}
                  </div>
                  <div className="delight-op">
                    <b>产品机会：</b>
                    {d.opportunity}
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </div>

      {/* 极值 + 敌意 */}
      <div className="para-section">
        <div className="para-h">

          <span className="para-h-title">极值 & 敌意情景</span>
          <span className="para-h-hint">§8.3 · 方法论硬要求</span>
        </div>
        <div className="edge-grid">
          <div className="edge-col">
            <div className="edge-col-head edge-extreme">极值情景 · {stage.deep.extremes.length} 个</div>
            {stage.deep.extremes.map((e) => (
              <div key={e.id} className="edge-item">
                <div className="edge-item-head">
                  <span className="edge-dim">{DIMENSION_META[e.dim].label}</span>
                  <span className="edge-limit">推到：{e.pushed_to_limit}</span>
                </div>
                <div className="edge-desc">{e.description}</div>
                <div className="edge-gap">
                  <b>鲁棒性缺口：</b>
                  {e.robustness_gap}
                </div>
              </div>
            ))}
          </div>
          <div className="edge-col">
            <div className="edge-col-head edge-hostile">敌意情景 · {stage.deep.hostiles.length} 个</div>
            {stage.deep.hostiles.map((h) => (
              <div key={h.id} className={`edge-item sev-${h.severity}`}>
                <div className="edge-item-head">
                  <span className="edge-attack">{h.attack}</span>
                  <span className={`sev-badge sev-${h.severity}`}>{h.severity === 'high' ? '严重' : h.severity === 'medium' ? '中' : '低'}</span>
                </div>
                <div className="edge-desc">
                  <b>受害者：</b>
                  {h.vulnerable_users}
                </div>
                <div className="edge-mitigation">
                  <b>缓解：</b>
                  {h.mitigation}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 设计启发 */}
      <div className="para-section">
        <div className="para-h">

          <span className="para-h-title">设计启发</span>
          <span className="para-h-hint">
            §8.5 固定格式 · {stage.deep.design_insights.length} 条 · 直接喂给功能列表节点
          </span>
        </div>
        <div className="insight-list">
          {stage.deep.design_insights.map((ins, i) => {
            const s = scenarioById.get(ins.scenario_id);
            const j = ins.job_id ? jobById.get(ins.job_id) : undefined;
            return (
              <div key={ins.id} className="insight-card">
                <div className="insight-num">{String(i + 1).padStart(2, '0')}</div>
                <div className="insight-body">
                  <div className="insight-text">{ins.insight_text}</div>
                  <div className="insight-action">
                    <b>设计动作：</b>
                    {ins.action}
                  </div>
                  <div className="insight-trace">
                    {s ? <span className="insight-trace-item">情景：{s.title}</span> : null}
                    {j ? <span className="insight-trace-item">Job：{j.title}</span> : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

function ScenarioJobMatrix({
  pickedScenarios,
  jobs,
  cells,
}: {
  pickedScenarios: ScenarioDraft[];
  jobs: Job[];
  cells: ScenarioDeepAnalysis['matrix'];
}) {
  if (jobs.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">尚无已锁 Job</div>
        <p>回到用户与任务节点锁定至少 1 个 Job，再回来看矩阵。</p>
      </div>
    );
  }
  const get = (sid: string, jid: string) => cells.find((c) => c.scenario_id === sid && c.job_id === jid);
  const fiLabel: Record<string, string> = { low: '低', medium: '中', high: '高' };
  return (
    <div className="matrix-shell">
      <div className="matrix-legend">
        <span className="matrix-legend-item cat-core"><span className="matrix-legend-dot" /> 核心</span>
        <span className="matrix-legend-item cat-safety_net"><span className="matrix-legend-dot" /> 安全网</span>
        <span className="matrix-legend-item cat-fringe"><span className="matrix-legend-dot" /> 边缘</span>
        <span className="matrix-legend-sep" />
        <span className="matrix-legend-hint">F = 频率 · I = 重要度</span>
      </div>
      <div className="matrix-wrap">
        <table className="matrix" style={{ ['--matrix-cols' as string]: jobs.length }}>
          <thead>
            <tr>
              <th className="matrix-corner">
                <span className="matrix-corner-row">情景</span>
                <span className="matrix-corner-slash">／</span>
                <span className="matrix-corner-col">Job</span>
              </th>
              {jobs.map((j) => (
                <th key={j.id} className="matrix-col-head" title={j.title}>
                  <div className="matrix-th-title">{j.title}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pickedScenarios.map((s) => (
              <tr key={s.id}>
                <th className="matrix-row-head" title={`${s.title}\n${s.meta}`}>
                  <div className="matrix-th-title">{s.title}</div>
                  {s.meta ? <div className="matrix-th-meta">{s.meta}</div> : null}
                </th>
                {jobs.map((j) => {
                  const c = get(s.id, j.id);
                  if (!c) {
                    return (
                      <td key={j.id} className="matrix-cell cat-fringe matrix-cell-empty">
                        <div className="matrix-empty">—</div>
                      </td>
                    );
                  }
                  return (
                    <td
                      key={j.id}
                      className={`matrix-cell cat-${c.category}`}
                      title={c.note}
                    >
                      <div className="matrix-cell-head">
                        <span className="matrix-cat">{CATEGORY_LABEL[c.category]}</span>
                        <span className="matrix-fi-pair">
                          <span className={`matrix-fi-chip fi-${c.frequency}`} title={`频率 ${fiLabel[c.frequency] ?? c.frequency}`}>F·{fiLabel[c.frequency] ?? c.frequency}</span>
                          <span className={`matrix-fi-chip fi-${c.importance}`} title={`重要度 ${fiLabel[c.importance] ?? c.importance}`}>I·{fiLabel[c.importance] ?? c.importance}</span>
                        </span>
                      </div>
                      <div className="matrix-note">{c.note}</div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
