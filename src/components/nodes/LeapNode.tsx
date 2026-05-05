'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { NodeFollowUpsSection } from '@/components/shared/NodeFollowUpsSection';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/tasks/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/tasks/analyze-users';
import type { FeatureList } from '@/lib/ai/tasks/draft-features';
import type { AlternativesAnalysis } from '@/lib/ai/tasks/analyze-alternatives';
import type {
  AnalogyTransfer,
  ConstraintFlip,
  CreativeLeapAnalysis,
  FirstPrincipleRethink,
} from '@/lib/ai/tasks/creative-leap';
import type { FeatureRevision, RevisionNote } from '@/lib/ai/tasks/revise-features';
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

type ItemState = 'neutral' | 'selected' | 'rejected';
type Category = 'first_principles' | 'analogies' | 'constraint_flips';

type Stage =
  | { kind: 'idle' }
  | { kind: 'analyzing' }
  | {
      kind: 'done';
      analysis: CreativeLeapAnalysis;
      states: Record<string, ItemState>;
      locked: Record<string, boolean>;
      regeneratingCategory: Category | null;
      revising: boolean;
      revision: FeatureRevision | null;
    };

interface Props {
  projectSlug: string;
  brief: BriefExtraction | null;
  usersContent: CachedUsers | null;
  featContent: FeatureList | null;
  altContent: AlternativesAnalysis | null;
  initial?: CreativeLeapAnalysis;
}

const TIMING_META: Record<
  CreativeLeapAnalysis['recommendation']['timing_verdict'],
  { label: string; cls: string; hint: string }
> = {
  bold:      { label: '大胆跃迁',   cls: 'go',    hint: '进入红海 / 怀疑共识 / 方案注定平庸 —— 推翻多个常规假设' },
  selective: { label: '精选跃迁',   cls: 'maybe', hint: '大致走标准路径 · 但在 1-2 个关键点上做独立判断（大部分项目在这档）' },
  minimal:   { label: '最小跃迁',   cls: 'skip',  hint: '项目本质要稳 · 至少保留 1 条跃迁 —— 全盘照抄行业模板不叫设计' },
};

const METHOD_LABEL: Record<Category, string> = {
  first_principles: '第一性原理',
  analogies: '类比迁移',
  constraint_flips: '约束反转',
};

const FEAS_META: Record<'high' | 'medium' | 'low', { label: string; cls: string }> = {
  high:   { label: '高可行',   cls: 'feas-high' },
  medium: { label: '中等',     cls: 'feas-medium' },
  low:    { label: '低可行',   cls: 'feas-low' },
};

const FLIP_LABEL: Record<ConstraintFlip['flip_type'], string> = {
  remove_constraint: '去掉约束',
  add_constraint: '加一个约束',
  reverse_goal: '反转目标',
};

function getState(states: Record<string, ItemState> | undefined, id: string): ItemState {
  return (states ?? {})[id] ?? 'neutral';
}

export function LeapNode({
  projectSlug,
  brief: briefFromServer,
  usersContent,
  featContent,
  altContent,
  initial,
}: Props) {
  const router = useRouter();
  const [brief, setBrief] = useState<BriefExtraction | null>(briefFromServer);
  const [cachedBrief, setCachedBrief] = useState<CachedBrief | null>(null);
  const [cachedUsers, setCachedUsers] = useState<CachedUsers | null>(usersContent);
  const [cachedFeat, setCachedFeat] = useState<FeatureList | null>(featContent);
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
    if (!cachedFeat) {
      const c = readCache<FeatureList>(projectSlug, 'feat');
      if (c) setCachedFeat(c);
    }
    if (!cachedAlt) {
      const c = readCache<AlternativesAnalysis>(projectSlug, 'alt');
      if (c) setCachedAlt(c);
    }
  }, [brief, cachedUsers, cachedFeat, cachedAlt, projectSlug]);

  const [stage, setStage] = useState<Stage>(() =>
    initial
      ? { kind: 'done', analysis: initial, states: {}, locked: {}, regeneratingCategory: null, revising: false, revision: null }
      : { kind: 'idle' },
  );
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();

  // Restore from cache · 兼容三种形状：
  //   v1: CreativeLeapAnalysis（裸数据）
  //   v2: { analysis, states }（旧版，states 可能包含 'locked' 旧值）
  //   v3: { analysis, states, locked }（当前）
  useEffect(() => {
    if (stage.kind !== 'idle') return;
    const cached = readCache<
      | { analysis: CreativeLeapAnalysis; states?: Record<string, string>; locked?: Record<string, boolean> }
      | CreativeLeapAnalysis
    >(projectSlug, 'leap');
    if (!cached) return;
    const isWrapped =
      typeof cached === 'object' &&
      cached !== null &&
      'analysis' in (cached as Record<string, unknown>) &&
      (cached as { analysis: unknown }).analysis != null;
    const analysis = isWrapped
      ? (cached as { analysis: CreativeLeapAnalysis }).analysis
      : (cached as CreativeLeapAnalysis);
    if (!analysis?.recommendation) return;
    const rawStates = isWrapped
      ? ((cached as { states?: Record<string, string> }).states ?? {})
      : {};
    // 迁移旧版 'locked' 状态 → 独立的 locked 字典 + states 置为 'selected'
    const states: Record<string, ItemState> = {};
    const locked: Record<string, boolean> = isWrapped
      ? { ...(cached as { locked?: Record<string, boolean> }).locked }
      : {};
    for (const [id, s] of Object.entries(rawStates)) {
      if (s === 'locked') {
        states[id] = 'selected';
        locked[id] = true;
      } else if (s === 'selected' || s === 'rejected') {
        states[id] = s;
      }
    }
    setStage({ kind: 'done', analysis, states, locked, regeneratingCategory: null, revising: false, revision: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  const persistDone = (next: Extract<Stage, { kind: 'done' }>) => {
    writeCache(projectSlug, 'leap', { analysis: next.analysis, states: next.states, locked: next.locked });
  };

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
    if (cachedFeat?.features) payload.features = cachedFeat.features;
    if (cachedAlt?.differentiation_hypothesis)
      payload.differentiation_hypothesis = cachedAlt.differentiation_hypothesis;
    if (cachedAlt?.key_threats) payload.alt_threats = cachedAlt.key_threats;
    return payload;
  };

  const run = () => {
    setError(null);
    setStage({ kind: 'analyzing' });
    startTransition(async () => {
      try {
        const res = await fetch('/api/ai/creative-leap', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'initial', ...buildCtxPayload() }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          data?: CreativeLeapAnalysis;
          error?: string;
          detail?: string;
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '跃迁分析失败');
        }
        const next: Extract<Stage, { kind: 'done' }> = {
          kind: 'done',
          analysis: json.data,
          states: {},
          locked: {},
          regeneratingCategory: null,
          revising: false,
          revision: null,
        };
        persistDone(next);
        setStage(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'idle' });
      }
    });
  };

  const applyLeapsToFeatures = () => {
    if (stage.kind !== 'done') return;
    const selectedIds = [
      ...stage.analysis.first_principles,
      ...stage.analysis.analogies,
      ...stage.analysis.constraint_flips,
    ]
      .filter((it) => getState(stage.states, it.id) === 'selected')
      .map((it) => it.id);
    if (selectedIds.length === 0) {
      setError('至少选中 1 条跃迁才能应用到功能列表');
      return;
    }
    if (!cachedFeat) {
      setError('没找到功能列表 · 请先完成 06 节点');
      return;
    }
    setError(null);
    const snapshot: Extract<Stage, { kind: 'done' }> = { ...stage, revising: true };
    setStage(snapshot);
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {
          projectSlug,
          original: cachedFeat,
          leaps: stage.analysis,
          selectedLeapIds: selectedIds,
          ...buildCtxPayload(),
        };
        const res = await fetch('/api/ai/revise-features', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          data?: FeatureRevision;
          error?: string;
          detail?: string;
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '应用跃迁失败');
        }
        // 写入 'final' 缓存 · 与 API 对齐 · 不动 'feat'（06 保留原版）
        const finalContent = {
          features: json.data.revised_features,
          pillars: json.data.revised_pillars,
          not_doing: json.data.revised_not_doing,
          differentiation_echo: json.data.differentiation_echo,
          revision: {
            revisions: json.data.revisions,
            summary: json.data.summary,
            critiques: json.data.critiques,
            selected_leap_ids: selectedIds,
            revised_at: new Date().toISOString(),
          },
          source_features: cachedFeat.features,
          source_pillars: cachedFeat.pillars,
          source_not_doing: cachedFeat.not_doing,
          source_differentiation_echo: cachedFeat.differentiation_echo,
        };
        writeCache(projectSlug, 'final', finalContent);
        const next: Extract<Stage, { kind: 'done' }> = {
          ...stage,
          revising: false,
          revision: json.data,
        };
        persistDone(next);
        setStage(next);
        // 不自动跳转 · 用户可点"进入 08 最终功能列表 →"按钮
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ ...snapshot, revising: false });
      }
    });
  };

  const cycleState = (id: string, mode: 'select' | 'reject' | 'lock') => {
    if (stage.kind !== 'done') return;
    // 锁定独立于选中/废弃 · 用于再补时保持不变
    if (mode === 'lock') {
      const nextLocked = { ...(stage.locked ?? {}) };
      if (nextLocked[id]) delete nextLocked[id];
      else nextLocked[id] = true;
      const next: Extract<Stage, { kind: 'done' }> = { ...stage, locked: nextLocked };
      persistDone(next);
      setStage(next);
      return;
    }
    const current = getState(stage.states, id);
    const transition: Record<'select' | 'reject', (c: ItemState) => ItemState> = {
      select: (c) => (c === 'selected' ? 'neutral' : 'selected'),
      reject: (c) => (c === 'rejected' ? 'neutral' : 'rejected'),
    };
    const newState = transition[mode](current);
    const next: Extract<Stage, { kind: 'done' }> = {
      ...stage,
      states: { ...(stage.states ?? {}), [id]: newState },
    };
    persistDone(next);
    setStage(next);
  };

  const regenerateCategory = (category: Category) => {
    if (stage.kind !== 'done') return;
    setError(null);
    const snapshot: Extract<Stage, { kind: 'done' }> = { ...stage, regeneratingCategory: category };
    setStage(snapshot);
    startTransition(async () => {
      try {
        const statesMap = stage.states ?? {};
        const lockedMap = stage.locked ?? {};
        const existingArr = stage.analysis[category] as Array<{ id: string }>;
        const locked_ids = existingArr.filter((it) => lockedMap[it.id]).map((it) => it.id);
        const rejected_ids = existingArr
          .filter((it) => statesMap[it.id] === 'rejected')
          .map((it) => it.id);

        const payload: Record<string, unknown> = {
          action: 'more',
          category,
          existing: existingArr.filter((it) => lockedMap[it.id]),
          locked_ids,
          rejected_ids,
          ...buildCtxPayload(),
        };
        const res = await fetch('/api/ai/creative-leap', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          data?: {
            first_principles?: unknown[];
            analogies?: unknown[];
            constraint_flips?: unknown[];
          };
          error?: string;
          detail?: string;
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '再生成失败');
        }
        const newItemsRaw = (json.data[category] ?? []) as Array<{ id: string }>;
        const existingIds = new Set(existingArr.map((e) => e.id));
        const newItems = newItemsRaw.map((it, i) => {
          let id = it.id;
          if (existingIds.has(id)) id = `${id}_v${existingArr.length + i + 1}`;
          existingIds.add(id);
          return { ...it, id };
        });
        // 保留 locked + 非 rejected 条目 · 丢弃 rejected · 追加新生成
        const lockedItems = existingArr.filter((it) => lockedMap[it.id]);
        const keptItems = existingArr.filter(
          (it) => !lockedMap[it.id] && statesMap[it.id] !== 'rejected',
        );
        const combined = [...lockedItems, ...keptItems, ...newItems];
        const nextAnalysis: CreativeLeapAnalysis = {
          ...stage.analysis,
          [category]: combined,
        } as CreativeLeapAnalysis;
        // Drop state entries for removed (rejected) ids
        const nextStates = { ...statesMap };
        for (const it of existingArr) {
          if (statesMap[it.id] === 'rejected') delete nextStates[it.id];
        }
        const next: Extract<Stage, { kind: 'done' }> = {
          ...stage,
          analysis: nextAnalysis,
          states: nextStates,
          regeneratingCategory: null,
          revising: stage.revising,
          revision: stage.revision,
        };
        persistDone(next);
        setStage(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ ...snapshot, regeneratingCategory: null });
      }
    });
  };

  const copilotCards = useMemo<CopilotCard[]>(() => {
    if (!brief) return [{ tag: 'check', title: '需要 Brief', body: '请先完成 Brief 节点' }];
    if (stage.kind === 'idle') {
      return [
        {
          tag: 'critique',
          title: '★ 设计真正从这里开始',
          body: (
            <>
              上一步的<em>功能列表</em>只是"基于前面分析的市场常规方案"——把需求翻译成行业标准模板。
              <em>还没有设计</em>。
              <div style={{ marginTop: 8 }}>
                <b>本节点决定了产品最终有没有差异化</b>：
                哪些点上我们不照抄常规？哪些假设可以被推翻？
                没有跃迁的产品 = 交付常规方案，不叫设计。
              </div>
            </>
          ),
        },
      ];
    }
    if (stage.kind === 'analyzing') {
      return [
        {
          tag: 'feed',
          title: '思考跃迁角度…',
          body: '三种方法同时拆，20+ 条候选，通常 90-180 秒。',
        },
      ];
    }
    const rec = stage.analysis.recommendation;
    const userCount =
      [
        ...stage.analysis.first_principles,
        ...stage.analysis.analogies,
        ...stage.analysis.constraint_flips,
      ].filter((it) => getState(stage.states, it.id) === 'selected').length;
    const cards: CopilotCard[] = [
      {
        tag:
          rec.timing_verdict === 'bold'
            ? 'critique'
            : rec.timing_verdict === 'selective'
              ? 'ask'
              : 'check',
        title: `胆量级别：${TIMING_META[rec.timing_verdict].label}`,
        body: (
          <>
            {rec.timing_reason}
            <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
              你已<em>选中</em> <b>{userCount}</b> 条 · AI 推荐 {rec.top_picks.length} 条。
              只需<em>选中</em>就能被应用到功能列表；<em>锁定 🔒</em>独立生效 ——
              仅用于"再补 3 条"时保持该条不被替换。
            </div>
          </>
        ),
      },
    ];
    for (const c of stage.analysis.critiques) cards.push({ tag: c.kind, title: c.title, body: c.body });
    return cards;
  }, [stage, brief]);

  if (!brief) {
    return (
      <div className="main">
        <main className="work">
          <div className="work-inner">
            <NodeHat />
            <h1 className="node-title">创造性跃迁：设计真正开始的地方</h1>
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-state-title">缺少 Brief 上下文</div>
              <p>
                请先完成{' '}
                <Link href={`/project/${projectSlug}/brief`} style={{ color: 'var(--accent)' }}>Brief</Link>
                。建议一起完成{' '}
                <Link href={`/project/${projectSlug}/feat`} style={{ color: 'var(--accent)' }}>06 功能列表</Link>
                ——没有功能列表，跃迁没有对照目标。
              </p>
            </div>
          </div>
        </main>
        <Copilot projectSlug={projectSlug} nodeKind="leap" cards={copilotCards} />
      </div>
    );
  }

  return (
    <div className="main">
      <main className="work wide">
        <div className="work-inner">
          <NodeHat chip={stageChip(stage)} />
          <h1 className="node-title">创造性跃迁：设计真正开始的地方</h1>
          <p className="node-intro">
            上一步的<em>功能列表</em>只是"市场常规方案的能力罗列"——把需求翻译成行业标准模板，
            <em>还没有设计</em>。本节点回答：<em>哪些点上我们不照抄常规？哪些假设可以被推翻？</em>
            从<em>第一性原理 / 类比迁移 / 约束反转</em>三角度给候选。
            <br />
            <b>✓ 选中</b>：决定哪些跃迁会被应用到功能列表。
            <b>✗ 废弃</b>：下次再补时避开该方向。
            <b>🔒 锁定</b>：独立开关，只在你点"再补 3 条"时保持该条不被替换（与选中无关）。
          </p>

          {stage.kind === 'idle' ? (
            <div className="para-section" style={{ display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="btn btn-accent" onClick={run}>
                生成跃迁候选 →
              </button>
            </div>
          ) : null}

          {stage.kind === 'analyzing' ? (
            <div className="para-section">
              <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                <span className="ai-spinner" />
                &nbsp; 同时从三角度思考 · 通常 90-180 秒……
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
              <TimingCard analysis={stage.analysis} />

              <CategorySection
                num="§ 1"
                title="第一性原理（§10.1）"
                hint={`剥离行业惯例 · ${stage.analysis.first_principles.length} 条`}
                items={stage.analysis.first_principles}
                states={stage.states}
                locked={stage.locked}
                regenerating={stage.regeneratingCategory === 'first_principles'}
                disabled={stage.regeneratingCategory !== null}
                onCycle={cycleState}
                onRegenerate={() => regenerateCategory('first_principles')}
                renderItem={(it) => <FirstPrincipleBody item={it as FirstPrincipleRethink} />}
              />

              <CategorySection
                num="§ 2"
                title="类比迁移（§10.2）"
                hint={`跨领域搬运成熟结构 · ${stage.analysis.analogies.length} 条`}
                items={stage.analysis.analogies}
                states={stage.states}
                locked={stage.locked}
                regenerating={stage.regeneratingCategory === 'analogies'}
                disabled={stage.regeneratingCategory !== null}
                onCycle={cycleState}
                onRegenerate={() => regenerateCategory('analogies')}
                renderItem={(it) => <AnalogyBody item={it as AnalogyTransfer} />}
                methodClass="leap-analogy"
              />

              <CategorySection
                num="§ 3"
                title="约束反转与极端化（§10.3）"
                hint={`改变一个前提 · ${stage.analysis.constraint_flips.length} 条`}
                items={stage.analysis.constraint_flips}
                states={stage.states}
                locked={stage.locked}
                regenerating={stage.regeneratingCategory === 'constraint_flips'}
                disabled={stage.regeneratingCategory !== null}
                onCycle={cycleState}
                onRegenerate={() => regenerateCategory('constraint_flips')}
                renderItem={(it) => <ConstraintFlipBody item={it as ConstraintFlip} />}
                methodClass="leap-flip"
              />

              <UserPicksSection analysis={stage.analysis} states={stage.states} locked={stage.locked} />

              <ApplyLeapsSection
                analysis={stage.analysis}
                states={stage.states}
                revision={stage.revision}
                revising={stage.revising}
                hasOriginalFeat={!!cachedFeat}
                onApply={applyLeapsToFeatures}
                projectSlug={projectSlug}
              />

              <div className="para-section" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-accent"
                  disabled={stage.revising || !stage.revision}
                  onClick={() => {
                    const nextK = nextNodeKind('leap');
                    if (nextK) router.push(`/project/${projectSlug}/${nextK}`);
                  }}
                  title={
                    stage.revising
                      ? '修订中 · 完成后可继续'
                      : !stage.revision
                        ? '先应用跃迁生成修订版，才能进入 08'
                        : undefined
                  }
                >
                  {(() => {
                    const n = nextNodeKind('leap');
                    const node = n ? getNode(n) : null;
                    return node ? `启动 · ${node.num} ${node.label} →` : '启动 →';
                  })()}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={run}
                  disabled={stage.revising}
                >
                  全部重新生成
                </button>
                {!stage.revision && !stage.revising ? (
                  <span className="dim" style={{ fontSize: 12 }}>
                    完成上方修订后即可启动 08 设计案
                  </span>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </main>

      <Copilot projectSlug={projectSlug} nodeKind="leap" cards={copilotCards} pending={stage.kind === 'analyzing'}
        extraSlot={stage.kind === 'done' ? <NodeFollowUpsSection projectSlug={projectSlug} nodeKind="leap" content={(stage.analysis) as unknown as Record<string, unknown>} /> : null}
      />
    </div>
  );
}

// ------------------------------------------------------------------

function NodeHat({ chip }: { chip?: string } = {}) {
  return (
    <div className="node-hat">
      <span className="node-hat-num">{formatNodeNum('leap')}</span>
      <span className="node-hat-rule" />
      <span className="node-hat-chip">{chip ?? '★ 设计真正开始的地方'}</span>
    </div>
  );
}

function stageChip(stage: Stage): string {
  if (stage.kind === 'idle') return '★ 设计真正开始的地方';
  if (stage.kind === 'analyzing') return '思考跃迁中…';
  return '已生成 · 可选/废/锁';
}

function TimingCard({ analysis }: { analysis: CreativeLeapAnalysis }) {
  const rec = analysis.recommendation;
  const meta = TIMING_META[rec.timing_verdict];
  return (
    <div className={`leap-timing verdict-${meta.cls}`}>
      <div className="leap-timing-label">胆量级别</div>
      <div className="leap-timing-title">{meta.label}</div>
      <div className="leap-timing-reason">{rec.timing_reason}</div>
      <div className="leap-timing-hint">{meta.hint}</div>
    </div>
  );
}

function ItemActions({
  id, state, locked, onCycle,
}: {
  id: string;
  state: ItemState;
  locked: boolean;
  onCycle: (id: string, mode: 'select' | 'reject' | 'lock') => void;
}) {
  return (
    <div className="item-actions">
      <button
        type="button"
        className={`ia ia-sel ${state === 'selected' ? 'on' : ''}`}
        onClick={() => onCycle(id, 'select')}
        title={state === 'selected' ? '取消选中 · 不应用此条' : '选中这条（应用到功能列表）'}
      >
        ✓
      </button>
      <button
        type="button"
        className={`ia ia-rej ${state === 'rejected' ? 'on' : ''}`}
        onClick={() => onCycle(id, 'reject')}
        title={state === 'rejected' ? '取消废弃' : '废弃（下次再补时避开这方向）'}
      >
        ✗
      </button>
      <button
        type="button"
        className={`ia ia-lock ${locked ? 'on' : ''}`}
        onClick={() => onCycle(id, 'lock')}
        title={locked ? '解锁（再补时该条可被替换）' : '锁定（仅用于再补时保持该条不变 · 与选中无关）'}
      >
        {locked ? '🔒' : '🔓'}
      </button>
    </div>
  );
}

interface HasFeasibility { feasibility: 'high' | 'medium' | 'low' }
interface HasId { id: string }

function CategorySection<T extends HasId & HasFeasibility>({
  num, title, hint, items, states, locked,
  regenerating, disabled,
  onCycle, onRegenerate,
  renderItem,
  methodClass = 'leap-fp',
}: {
  num: string;
  title: string;
  hint: string;
  items: T[];
  states: Record<string, ItemState> | undefined;
  locked: Record<string, boolean> | undefined;
  regenerating: boolean;
  disabled: boolean;
  onCycle: (id: string, mode: 'select' | 'reject' | 'lock') => void;
  onRegenerate: () => void;
  renderItem: (it: T) => React.ReactNode;
  methodClass?: string;
}) {
  const safe = states ?? {};
  const lockSafe = locked ?? {};
  const selectedCount = items.filter((it) => safe[it.id] === 'selected').length;
  const lockedCount = items.filter((it) => lockSafe[it.id]).length;
  const rejectedCount = items.filter((it) => safe[it.id] === 'rejected').length;

  return (
    <div className="para-section">
      <div className="para-h">
        <span className="para-h-num">{num}</span>
        <span className="para-h-title">{title}</span>
        <span className="para-h-hint">{hint}</span>
      </div>
      <div className="leap-list">
        {items.map((it, i) => {
          const s = safe[it.id] ?? 'neutral';
          const isLocked = !!lockSafe[it.id];
          return (
            <div
              key={it.id}
              className={`leap-card ${methodClass} feas-${it.feasibility} state-${s}${isLocked ? ' is-locked' : ''}`}
            >
              <div className="leap-card-num">{String(i + 1).padStart(2, '0')}</div>
              <div className="leap-card-body">{renderItem(it)}</div>
              <div className={`leap-feas ${FEAS_META[it.feasibility].cls}`}>
                {FEAS_META[it.feasibility].label}
              </div>
              <ItemActions id={it.id} state={s} locked={isLocked} onCycle={onCycle} />
            </div>
          );
        })}
      </div>
      <div className="cat-footer">
        <div className="cat-footer-stats">
          <span className="cat-stat total">{items.length} 条</span>
          {selectedCount > 0 ? <span className="cat-stat selected">✓ {selectedCount} 选中</span> : null}
          {lockedCount > 0 ? <span className="cat-stat locked">🔒 {lockedCount} 锁定</span> : null}
          {rejectedCount > 0 ? <span className="cat-stat rejected">🗑 {rejectedCount} 废弃</span> : null}
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onRegenerate}
          disabled={disabled}
        >
          {regenerating ? (
            <>
              <span className="ai-spinner" />&nbsp; 生成中
            </>
          ) : (
            <>⟳ 再补 3 条（保留锁定 · 避开废弃）</>
          )}
        </button>
      </div>
    </div>
  );
}

function FirstPrincipleBody({ item }: { item: FirstPrincipleRethink }) {
  return (
    <>
      <div className="leap-step">
        <span className="leap-step-label">行业共识</span>
        <span className="leap-step-text">{item.industry_assumption}</span>
      </div>
      <div className="leap-step arrow">↓ 剥到物理 / 底层</div>
      <div className="leap-step">
        <span className="leap-step-label">真实底层</span>
        <span className="leap-step-text">{item.physical_floor}</span>
      </div>
      <div className="leap-step arrow">↓ 由此推出</div>
      <div className="leap-step opportunity">
        <span className="leap-step-label">设计机会</span>
        <span className="leap-step-text">{item.opportunity}</span>
      </div>
    </>
  );
}

function AnalogyBody({ item }: { item: AnalogyTransfer }) {
  return (
    <>
      <div className="analogy-head">
        <span className="analogy-essence">本质：{item.core_essence}</span>
        <span className="analogy-arrow">借鉴自</span>
        <span className="analogy-source">{item.source_domain}</span>
      </div>
      <div className="analogy-row">
        <div className="analogy-col">
          <div className="analogy-col-label">源领域机制</div>
          <div className="analogy-col-text">{item.source_mechanism}</div>
        </div>
        <div className="analogy-col">
          <div className="analogy-col-label">迁移到本项目</div>
          <div className="analogy-col-text accent">{item.transferred_mechanism}</div>
        </div>
      </div>
      <div className="analogy-notes">
        <b>适配提示：</b>{item.adaptation_notes}
      </div>
    </>
  );
}

function ConstraintFlipBody({ item }: { item: ConstraintFlip }) {
  return (
    <>
      <div className="flip-type">{FLIP_LABEL[item.flip_type]}</div>
      <div className="flip-row">
        <div className="flip-original">
          <span className="flip-label">原约束</span>
          <div>{item.original}</div>
        </div>
        <div className="flip-arrow">→</div>
        <div className="flip-flipped">
          <span className="flip-label">反转后</span>
          <div>{item.flipped}</div>
        </div>
      </div>
      <div className="flip-surprise">
        <b>暴露了什么：</b>{item.surprise}
      </div>
      <div className="flip-impact">
        <b>对功能列表的影响：</b>{item.impact_on_features}
      </div>
    </>
  );
}

function UserPicksSection({
  analysis,
  states,
  locked,
}: {
  analysis: CreativeLeapAnalysis;
  states: Record<string, ItemState> | undefined;
  locked: Record<string, boolean> | undefined;
}) {
  const safe = states ?? {};
  const lockSafe = locked ?? {};
  const items: Array<{ item: HasId; method: Category; title: string }> = [];
  for (const it of analysis.first_principles) {
    items.push({ item: it, method: 'first_principles', title: it.opportunity });
  }
  for (const it of analysis.analogies) {
    items.push({ item: it, method: 'analogies', title: it.transferred_mechanism });
  }
  for (const it of analysis.constraint_flips) {
    items.push({ item: it, method: 'constraint_flips', title: it.flipped });
  }
  const picked = items.filter(({ item }) => safe[item.id] === 'selected');

  if (picked.length === 0 && analysis.recommendation.top_picks.length === 0) return null;

  return (
    <>
      {picked.length > 0 ? (
        <div className="para-section">
          <div className="para-h">

            <span className="para-h-title">你采纳的跃迁</span>
            <span className="para-h-hint">{picked.length} 条 · 带入后续节点</span>
          </div>
          <div className="user-picks">
            {picked.map(({ item, method, title }) => (
              <div key={item.id} className={`user-pick method-${method}`}>
                <span className={`user-pick-method pick-${method}`}>
                  {method === 'first_principles' ? '第一性' : method === 'analogies' ? '类比' : '反转'}
                </span>
                <span className="user-pick-title">{title}</span>
                {lockSafe[item.id] ? <span className="user-pick-lock">🔒</span> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {analysis.recommendation.top_picks.length > 0 ? (
        <div className="para-section">
          <div className="para-h">

            <span className="para-h-title">AI 推荐采纳</span>
            <span className="para-h-hint">
              {analysis.recommendation.top_picks.length} 条 · 可作参考
            </span>
          </div>
          <div className="top-picks">
            {analysis.recommendation.top_picks.map((p, i) => (
              <div key={i} className="pick-card">
                <div className="pick-head">
                  <span className="pick-num">#{i + 1}</span>
                  <span className="pick-method">{METHOD_LABEL[p.source_method as Category]}</span>
                </div>
                <div className="pick-why">{p.why}</div>
                {p.required_changes.length > 0 ? (
                  <div className="pick-changes">
                    <div className="pick-changes-label">若采纳，功能列表要改：</div>
                    <ul>
                      {p.required_changes.map((c, j) => (
                        <li key={j}>{c}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  );
}

function ApplyLeapsSection({
  analysis,
  states,
  revision,
  revising,
  hasOriginalFeat,
  onApply,
  projectSlug,
}: {
  analysis: CreativeLeapAnalysis;
  states: Record<string, ItemState> | undefined;
  revision: FeatureRevision | null;
  revising: boolean;
  hasOriginalFeat: boolean;
  onApply: () => void;
  projectSlug: string;
}) {
  const safe = states ?? {};
  const selectedCount = [
    ...analysis.first_principles,
    ...analysis.analogies,
    ...analysis.constraint_flips,
  ].filter((it) => safe[it.id] === 'selected').length;

  return (
    <div className="para-section apply-leaps-section">
      <div className="para-h">

        <span className="para-h-title">应用跃迁 · 产出最终功能列表</span>
        <span className="para-h-hint">§十 → §九 回流 · 方法论的闭环</span>
      </div>

      {!revision ? (
        <div className="apply-leaps-invite">
          <div className="apply-leaps-lead">
            方法论原则：<em>跃迁只有改变功能列表，才真正是设计</em>。
            在上方三类候选里勾选要采纳的条目，AI 会把它们应用到 06 的功能列表上，
            产出<em>独立的 08 最终功能列表</em>（不覆盖 06 原版）。
          </div>
          {!hasOriginalFeat ? (
            <div className="apply-leaps-warn">
              ⚠ 还没找到功能列表 · 请先完成 06 节点
            </div>
          ) : null}
          {selectedCount === 0 || revising ? (
            <div className="apply-leaps-empty">
              {revising ? (
                <><span className="ai-spinner" />&nbsp; 修订中 · 通常 90-150 秒</>
              ) : (
                <>★ 先在上方勾选 ≥1 条跃迁，才会出现<em>修订按钮</em></>
              )}
            </div>
          ) : (
            <button
              type="button"
              className="btn-revise"
              onClick={onApply}
              disabled={!hasOriginalFeat}
            >
              ✦ 应用 <b>{selectedCount}</b> 条跃迁 · 产出 08 最终功能列表
            </button>
          )}
        </div>
      ) : (
        <RevisionResult
          revision={revision}
          projectSlug={projectSlug}
          onReapply={onApply}
          revising={revising}
        />
      )}
    </div>
  );
}

function RevisionResult({
  revision,
  projectSlug,
  onReapply,
  revising,
}: {
  revision: FeatureRevision;
  projectSlug: string;
  onReapply: () => void;
  revising: boolean;
}) {
  const addCount = revision.revisions.filter((r) => r.action === 'added').length;
  const modCount = revision.revisions.filter((r) => r.action === 'modified').length;
  const remCount = revision.revisions.filter((r) => r.action === 'removed').length;

  return (
    <div className="revision-result">
      <div className="revision-summary">
        <div className="revision-head">
          <span className="revision-title">✓ 功能列表已修订</span>
          <div className="revision-stats">
            <span className="rev-stat added">+{addCount} 新增</span>
            <span className="rev-stat modified">~{modCount} 修改</span>
            <span className="rev-stat removed">−{remCount} 删除</span>
          </div>
        </div>
        <div className="revision-summary-body">{revision.summary}</div>
      </div>

      <div className="revision-list">
        <div className="revision-list-label">逐条变更</div>
        {revision.revisions
          .filter((r) => r.action !== 'kept')
          .map((r, i) => (
            <RevisionItem key={i} note={r} />
          ))}
      </div>

      <div className="revision-echo">
        <div className="revision-echo-label">新差异化假设</div>
        <div className="revision-echo-body">{revision.differentiation_echo}</div>
      </div>

      <div className="revision-actions">
        <a href={`/project/${projectSlug}/final`} className="btn btn-accent">
          启动 · 08 设计案 →
        </a>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onReapply}
          disabled={revising}
        >
          {revising ? (
            <><span className="ai-spinner" />&nbsp; 重新修订</>
          ) : (
            '重新应用（改了选择后）'
          )}
        </button>
      </div>
    </div>
  );
}

function RevisionItem({ note }: { note: RevisionNote }) {
  const actionMeta: Record<RevisionNote['action'], { label: string; cls: string; icon: string }> = {
    added:    { label: '新增', cls: 'added',    icon: '+' },
    modified: { label: '修改', cls: 'modified', icon: '~' },
    removed:  { label: '删除', cls: 'removed',  icon: '−' },
    kept:     { label: '保留', cls: 'kept',     icon: '=' },
  };
  const a = actionMeta[note.action];
  return (
    <div className={`revision-item rev-${a.cls}`}>
      <span className={`rev-action rev-${a.cls}`}>
        {a.icon} {a.label}
      </span>
      <div className="revision-item-body">
        {note.action === 'modified' ? (
          <div className="revision-diff">
            <span className="diff-old">{note.name_before ?? note.original_feature_id}</span>
            <span className="diff-arrow">→</span>
            <span className="diff-new">{note.name_after ?? note.feature_id}</span>
          </div>
        ) : (
          <div className="revision-feature-name">
            {note.action === 'added' ? note.name_after : note.name_before ?? note.original_feature_id}
          </div>
        )}
        <div className="revision-reason">{note.reason}</div>
        {note.source_leap_ids.length > 0 ? (
          <div className="revision-sources">
            来源跃迁：{note.source_leap_ids.map((id) => <span key={id} className="rev-leap-id">{id}</span>)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
