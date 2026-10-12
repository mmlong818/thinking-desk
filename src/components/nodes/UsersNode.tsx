'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { NodeFollowUpsSection } from '@/components/shared/NodeFollowUpsSection';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/schemas/extract-brief';
import type { Job, Persona, UsersAnalysis, JobsRefinement } from '@/lib/ai/schemas/analyze-users';
import { readCache, writeCache } from '@/lib/client-cache';
import { readPreferredModel } from '@/lib/client-model';
import { nextNodeKind, getNode, formatNodeNum } from '@/data/nodes';

interface CachedBrief extends BriefExtraction {
  raw_text?: string;
  answers?: ClarificationAnswer[];
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'analyzing' }
  | {
      kind: 'done';
      analysis: UsersAnalysis;
      personas: Persona[];
      personaLocked: Record<string, boolean>;
      jobLocked: Record<string, boolean>;
      addingMore: boolean;
      refiningJobs: boolean;
      /** Snapshot of personaLocked at the time Jobs were last refined.
       *  Used to show "画像已变 → Jobs 需要刷新" hint. */
      jobsBasedOn: string[];
    };

interface Props {
  projectSlug: string;
  brief: BriefExtraction | null;
  initial?: UsersAnalysis & {
    jobLocked?: Record<string, boolean>;
    personaLocked?: Record<string, boolean>;
    extraPersonas?: Persona[];
  };
}

const GROUP_META: Record<'functional' | 'emotional' | 'social', { label: string; tag: string; hint: string }> = {
  functional: { label: '功能性 Job', tag: 'FUNCTIONAL', hint: '任务要完成的客观事实' },
  emotional:  { label: '情感性 Job', tag: 'EMOTIONAL',  hint: '任务背后的主观感受' },
  social:     { label: '社交性 Job', tag: 'SOCIAL',     hint: '他人眼里的"我"' },
};

const MAX_PERSONAS = 10;

export function UsersNode({ projectSlug, brief: briefFromServer, initial }: Props) {
  const router = useRouter();
  const [brief, setBrief] = useState<BriefExtraction | null>(briefFromServer);
  const [cachedBrief, setCachedBrief] = useState<CachedBrief | null>(null);

  // If server didn't hydrate a Brief (DB off), try sessionStorage.
  useEffect(() => {
    if (brief) return;
    const cached = readCache<CachedBrief>(projectSlug, 'brief');
    if (cached) {
      setCachedBrief(cached);
      setBrief({
        highlights: cached.highlights,
        fields: cached.fields,
        follow_ups: cached.follow_ups,
        completeness: cached.completeness,
      });
    }
  }, [brief, projectSlug]);

  const [stage, setStage] = useState<Stage>(() => {
    if (initial) {
      const allPersonas = [
        ...initial.personas,
        ...(initial.extraPersonas ?? []),
      ];
      const jobLocked: Record<string, boolean> = initial.jobLocked ?? {};
      if (Object.keys(jobLocked).length === 0) {
        for (const group of ['functional', 'emotional', 'social'] as const) {
          for (const j of initial.jobs[group]) {
            if (j.suggested_priority) jobLocked[j.id] = true;
          }
        }
      }
      const personaLocked: Record<string, boolean> = initial.personaLocked ?? {};
      if (Object.keys(personaLocked).length === 0) {
        // 默认全部锁定：产品通常要同时服务多个典型用户
        for (const p of allPersonas) personaLocked[p.id] = true;
      }
      return {
        kind: 'done',
        analysis: initial,
        personas: allPersonas,
        personaLocked,
        jobLocked,
        addingMore: false,
        refiningJobs: false,
        jobsBasedOn: Object.keys(personaLocked).filter((k) => personaLocked[k]).sort(),
      };
    }
    return { kind: 'idle' };
  });
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();

  // On mount, also try restoring whole users node from cache (navigation back).
  useEffect(() => {
    if (stage.kind !== 'idle') return;
    const cached = readCache<Partial<Extract<Stage, { kind: 'done' }>>>(projectSlug, 'users-ui');
    if (!cached || cached.kind !== 'done' || !cached.analysis || !cached.personas) return;
    // Back-fill defaults so older cached shapes don't break new UI code.
    const personaLocked = cached.personaLocked ?? {};
    const restored: Extract<Stage, { kind: 'done' }> = {
      kind: 'done',
      analysis: cached.analysis,
      personas: cached.personas,
      personaLocked,
      jobLocked: cached.jobLocked ?? {},
      addingMore: false,
      refiningJobs: false,
      jobsBasedOn:
        cached.jobsBasedOn ?? Object.keys(personaLocked).filter((k) => personaLocked[k]).sort(),
    };
    setStage(restored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  // Merge helpers — preserve user's explicit lock decisions across re-analysis
  // and refresh. `prev` is the previous lock state keyed by id; if the id
  // appears in `prev`, the user's choice (true/false) wins. New ids fall back
  // to `aiDefault(id)`.
  const mergeLocks = (
    prev: Record<string, boolean>,
    currentIds: string[],
    aiDefault: (id: string) => boolean,
  ): Record<string, boolean> => {
    const next: Record<string, boolean> = {};
    for (const id of currentIds) {
      next[id] = Object.prototype.hasOwnProperty.call(prev, id) ? prev[id] : aiDefault(id);
    }
    return next;
  };

  const persistDone = (next: Extract<Stage, { kind: 'done' }>) => {
    writeCache(projectSlug, 'users-ui', next);
    writeCache(projectSlug, 'users', {
      ...next.analysis,
      personas: next.personas.slice(0, next.analysis.personas.length),
      extraPersonas: next.personas.slice(next.analysis.personas.length),
      jobLocked: next.jobLocked,
      personaLocked: next.personaLocked,
    });
  };

  const analyze = () => {
    setError(null);
    // Snapshot prior user choices so a re-analysis can preserve them.
    const prevJobLocked = stage.kind === 'done' ? stage.jobLocked : {};
    const prevPersonaLocked = stage.kind === 'done' ? stage.personaLocked : {};
    setStage({ kind: 'analyzing' });
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
        const res = await fetch('/api/ai/analyze-users', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as { ok?: boolean; data?: UsersAnalysis; error?: string; detail?: string };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '分析失败');
        }
        const jobSuggested = new Map<string, boolean>();
        const jobIds: string[] = [];
        for (const group of ['functional', 'emotional', 'social'] as const) {
          for (const j of json.data.jobs[group]) {
            jobSuggested.set(j.id, j.suggested_priority);
            jobIds.push(j.id);
          }
        }
        const jobLocked = mergeLocks(prevJobLocked, jobIds, (id) => jobSuggested.get(id) ?? false);
        const personaIds = json.data.personas.map((p) => p.id);
        // Default for truly fresh analysis = all locked; re-analyses preserve prior choices.
        const personaLocked = mergeLocks(prevPersonaLocked, personaIds, () => true);
        const next: Extract<Stage, { kind: 'done' }> = {
          kind: 'done',
          analysis: json.data,
          personas: [...json.data.personas],
          personaLocked,
          jobLocked,
          addingMore: false,
          refiningJobs: false,
          jobsBasedOn: Object.keys(personaLocked).filter((k) => personaLocked[k]).sort(),
        };
        persistDone(next);
        setStage(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'idle' });
      }
    });
  };

  // Build the Brief context payload used by every AI call in this node.
  const buildBriefPayload = (): Record<string, unknown> => {
    const payload: Record<string, unknown> = {};
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
    return payload;
  };

  // Pure function: given personas + existing state, call refine-jobs and
  // return the merged analysis + jobLocked. Used by both the manual refresh
  // button and the auto-chain after add-personas.
  const callRefineJobs = async (
    personasForRefine: Persona[],
    personaLockedForRefine: Record<string, boolean>,
    existingJobs: UsersAnalysis['jobs'],
    existingJobLocked: Record<string, boolean>,
  ): Promise<{
    analysis: Pick<UsersAnalysis, 'jobs' | 'priority_summary' | 'critiques'>;
    jobLocked: Record<string, boolean>;
    jobsBasedOn: string[];
  }> => {
    const selectedPersonas = personasForRefine.filter((p) => personaLockedForRefine[p.id]);
    if (selectedPersonas.length === 0) {
      throw new Error('请至少选中 1 个 persona，然后再刷新 Jobs');
    }
    const payload: Record<string, unknown> = {
      projectSlug,
      selectedPersonas,
      existingJobs,
      userLockedJobIds: Object.keys(existingJobLocked).filter((k) => existingJobLocked[k]),
      ...buildBriefPayload(),
    };
    const preferred = readPreferredModel();
    if (preferred) payload.model = preferred;
    const res = await fetch('/api/ai/refine-jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      data?: JobsRefinement;
      error?: string;
      detail?: string;
    };
    if (!res.ok || !json.ok || !json.data) {
      throw new Error(json.detail ?? json.error ?? '刷新失败');
    }
    const suggested = new Map<string, boolean>();
    const ids: string[] = [];
    for (const group of ['functional', 'emotional', 'social'] as const) {
      for (const j of json.data.jobs[group]) {
        suggested.set(j.id, j.suggested_priority);
        ids.push(j.id);
      }
    }
    const jobLocked = mergeLocks(existingJobLocked, ids, (id) => suggested.get(id) ?? false);
    return {
      analysis: json.data,
      jobLocked,
      jobsBasedOn: selectedPersonas.map((p) => p.id).sort(),
    };
  };

  const addMorePersonas = () => {
    if (stage.kind !== 'done') return;
    if (stage.personas.length >= MAX_PERSONAS) return;
    setError(null);
    const snapshot: Extract<Stage, { kind: 'done' }> = { ...stage, addingMore: true };
    setStage(snapshot);
    startTransition(async () => {
      try {
        const payload: Record<string, unknown> = {
          projectSlug,
          existing: stage.personas,
          lockedIds: Object.keys(stage.personaLocked).filter((k) => stage.personaLocked[k]),
          ...buildBriefPayload(),
        };
        const preferred = readPreferredModel();
        if (preferred) payload.model = preferred;
        const res = await fetch('/api/ai/add-personas', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          data?: { personas: Persona[] };
          error?: string;
          detail?: string;
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '生成失败');
        }
        // Cap at MAX_PERSONAS; new personas default to locked so they
        // immediately influence downstream analysis.
        const newPersonas = json.data.personas;
        const combined = [...stage.personas, ...newPersonas].slice(0, MAX_PERSONAS);
        const newPersonaLocked = { ...stage.personaLocked };
        for (const p of newPersonas) newPersonaLocked[p.id] = true;

        // Show a transitional state — personas added, now refining jobs.
        const interim: Extract<Stage, { kind: 'done' }> = {
          ...stage,
          personas: combined,
          personaLocked: newPersonaLocked,
          addingMore: false,
          refiningJobs: true,
        };
        setStage(interim);

        // Chain into refine-jobs so the new personas actually update the
        // Jobs list instead of sitting there as a stale indicator.
        try {
          const refined = await callRefineJobs(
            combined,
            newPersonaLocked,
            stage.analysis.jobs,
            stage.jobLocked,
          );
          const finalStage: Extract<Stage, { kind: 'done' }> = {
            ...interim,
            analysis: {
              ...stage.analysis,
              jobs: refined.analysis.jobs,
              priority_summary: refined.analysis.priority_summary,
              critiques: refined.analysis.critiques,
            },
            jobLocked: refined.jobLocked,
            refiningJobs: false,
            jobsBasedOn: refined.jobsBasedOn,
          };
          persistDone(finalStage);
          setStage(finalStage);
        } catch (refineErr) {
          // Personas added ok; refine failed — keep the personas, mark bar stale.
          const fallbackStage: Extract<Stage, { kind: 'done' }> = {
            ...interim,
            refiningJobs: false,
          };
          persistDone(fallbackStage);
          setStage(fallbackStage);
          setError(
            `persona 已加入，但 Jobs 刷新失败：${
              refineErr instanceof Error ? refineErr.message : String(refineErr)
            } · 你可以稍后手动点刷新`,
          );
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ ...snapshot, addingMore: false });
      }
    });
  };

  const togglePersonaLock = (id: string) => {
    if (stage.kind !== 'done') return;
    const next: Extract<Stage, { kind: 'done' }> = {
      ...stage,
      personaLocked: { ...stage.personaLocked, [id]: !stage.personaLocked[id] },
    };
    persistDone(next);
    setStage(next);
  };

  const removePersona = (id: string) => {
    if (stage.kind !== 'done') return;
    if (stage.personaLocked[id]) return; // 锁定的不能移除
    const nextPersonas = stage.personas.filter((p) => p.id !== id);
    const nextLocked = { ...stage.personaLocked };
    delete nextLocked[id];
    const next: Extract<Stage, { kind: 'done' }> = {
      ...stage,
      personas: nextPersonas,
      personaLocked: nextLocked,
    };
    persistDone(next);
    setStage(next);
  };

  const refreshJobs = () => {
    if (stage.kind !== 'done') return;
    setError(null);
    const snapshot = { ...stage, refiningJobs: true };
    setStage(snapshot);
    startTransition(async () => {
      try {
        const refined = await callRefineJobs(
          stage.personas,
          stage.personaLocked,
          stage.analysis.jobs,
          stage.jobLocked,
        );
        const next: Extract<Stage, { kind: 'done' }> = {
          ...stage,
          analysis: {
            ...stage.analysis,
            jobs: refined.analysis.jobs,
            priority_summary: refined.analysis.priority_summary,
            critiques: refined.analysis.critiques,
          },
          jobLocked: refined.jobLocked,
          refiningJobs: false,
          jobsBasedOn: refined.jobsBasedOn,
        };
        persistDone(next);
        setStage(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ ...snapshot, refiningJobs: false });
      }
    });
  };

  const toggleJobLock = (id: string) => {
    if (stage.kind !== 'done') return;
    const next: Extract<Stage, { kind: 'done' }> = {
      ...stage,
      jobLocked: { ...stage.jobLocked, [id]: !stage.jobLocked[id] },
    };
    persistDone(next);
    setStage(next);
  };

  const copilotCards = useMemo<CopilotCard[]>(() => {
    if (!brief) {
      return [
        {
          tag: 'check',
          title: '当前节点在等 Brief',
          body: '每一个节点都会读前面节点的输出，保证分析的一致性。完成 Brief 后回来点"开始分析"即可。',
        },
      ];
    }
    if (stage.kind === 'idle') {
      return [
        {
          tag: 'feed',
          title: '准备好分析用户与 Job',
          body: (
            <>
              我已读完 Brief。点"开始分析"，我会一次产出 <b>3 个差异化 persona</b> + 三类 JTBD 清单。
              <em>不满意的可以让我再补，上限 10 个</em>。
            </>
          ),
        },
      ];
    }
    if (stage.kind === 'analyzing') {
      return [
        {
          tag: 'feed',
          title: '分析中…',
          body: '通常 20–60 秒。推理模型会同时做多个维度拆解。',
        },
      ];
    }
    const lockedCount = Object.values(stage.personaLocked).filter(Boolean).length;
    const cards: CopilotCard[] = [
      {
        tag: 'feed',
        title: stage.addingMore ? '正在生成新一批…' : `当前 ${stage.personas.length} 个 persona · ${lockedCount} 个已锁定`,
        body: stage.analysis.priority_summary,
      },
    ];
    for (const c of stage.analysis.critiques) {
      cards.push({ tag: c.kind, title: c.title, body: c.body });
    }
    if (stage.personas.length < MAX_PERSONAS && !stage.addingMore) {
      cards.push({
        tag: 'ask',
        title: `再生成 3 个？`,
        body: (
          <>
            锁定的角色会保留并作为参考，新的 3 个会<em>刻意避开已有维度</em>。
            当前 {stage.personas.length} / {MAX_PERSONAS}。
          </>
        ),
      });
    }
    return cards;
  }, [stage, brief]);

  if (!brief) {
    return (
      <div className="main">
        <main className="work">
          <div className="work-inner">
            <NodeHat />
            <h1 className="node-title">用户与任务：她到底要"雇"谁做什么事</h1>
            <p className="node-intro">
              这个节点吃 <em>Brief</em> 的产出做分析 —— 请先完成 Brief 节点，再回来。
            </p>
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-state-title">还没有 Brief 上下文</div>
              <p>
                Brief 节点产出的问题陈述、用户、场景、价值主张，会作为 JTBD 分析的输入。
                <br />
                请先去 <Link href={`/project/${projectSlug}/brief`} style={{ color: 'var(--accent)' }}>Brief 节点</Link> 粘贴原始需求并完成澄清。
              </p>
            </div>
          </div>
        </main>
        <Copilot projectSlug={projectSlug} nodeKind="users" cards={copilotCards} />
      </div>
    );
  }

  return (
    <div className="main">
      <main className="work">
        <div className="work-inner">
          <NodeHat chip={stageChip(stage)} />
          <h1 className="node-title">用户与任务：她到底要"雇"谁做什么事</h1>
          <p className="node-intro">
            不要先想"做什么功能"，<em>先想用户在哪个处境下雇了一个工具做什么 Job</em>。
            一个产品通常要<em>同时服务多个典型用户</em> —— 我先给你 3 个差异化 persona，
            默认全部选中作为产品覆盖对象，你可以取消不相关的，也可以让我再生成新的（上限 10 个）。
          </p>

          <BriefContext brief={brief} cached={cachedBrief} />

          {stage.kind === 'idle' ? (
            <div className="para-section" style={{ display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="btn btn-accent" onClick={analyze}>
                基于 Brief 开始分析 →
              </button>
            </div>
          ) : null}

          {stage.kind === 'analyzing' ? (
            <div className="para-section">
              <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                <span className="ai-spinner" />
                &nbsp; 正在拆解 3 个 persona + 三类 Job，通常 20–60 秒……
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
              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">用户画像库</span>
                  <span className="para-h-hint">
                    {stage.personas.length} / {MAX_PERSONAS} · {Object.values(stage.personaLocked).filter(Boolean).length} 已选
                  </span>
                </div>

                <PersonaGrid
                  personas={stage.personas}
                  locked={stage.personaLocked}
                  onLock={togglePersonaLock}
                  onRemove={removePersona}
                />

                <div style={{ marginTop: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={addMorePersonas}
                    disabled={stage.addingMore || stage.refiningJobs || stage.personas.length >= MAX_PERSONAS}
                  >
                    {stage.addingMore ? (
                      <><span className="ai-spinner" />&nbsp; 生成新 persona…</>
                    ) : stage.refiningJobs ? (
                      <><span className="ai-spinner" />&nbsp; 同步刷新 Jobs…</>
                    ) : stage.personas.length >= MAX_PERSONAS ? (
                      '已达 10 个上限'
                    ) : (
                      `+ 再生成 3 个（当前 ${stage.personas.length}）`
                    )}
                  </button>
                  <span className="dim" style={{ fontSize: 12 }}>
                    新 persona 会<b style={{color:'var(--ink-3)'}}>自动加入</b>并<b style={{color:'var(--ink-3)'}}>联动刷新 Jobs</b> · 锁定的角色保留
                  </span>
                </div>
              </div>

              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">Jobs-to-be-done 清单</span>
                  <span className="para-h-hint">
                    勾选为"优先" · {Object.values(stage.jobLocked).filter(Boolean).length} 个已锁定
                  </span>
                </div>

                <JobsRefreshBar
                  currentSelection={Object.keys(stage.personaLocked).filter((k) => stage.personaLocked[k]).sort()}
                  jobsBasedOn={stage.jobsBasedOn ?? []}
                  personas={stage.personas}
                  locked={stage.personaLocked}
                  refreshing={stage.refiningJobs ?? false}
                  onRefresh={refreshJobs}
                />

                {(['functional', 'emotional', 'social'] as const).map((group) => (
                  <JobGroup
                    key={group}
                    group={group}
                    jobs={stage.analysis.jobs[group]}
                    locked={stage.jobLocked}
                    personas={stage.personas}
                    onToggle={toggleJobLock}
                  />
                ))}
              </div>

              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">优先级锁定</span>
                  <span className="para-h-hint">锁定项将成为功能列表的总纲</span>
                </div>
                <LockedSummary
                  analysis={stage.analysis}
                  locked={stage.jobLocked}
                />
              </div>

              <div className="para-section" style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => {
                    const next = nextNodeKind('users');
                    if (next) router.push(`/project/${projectSlug}/${next}`);
                  }}
                >
                  继续 · 03 干系人 →
                </button>
                <button type="button" className="btn btn-ghost" onClick={analyze}>
                  全部重新分析
                </button>
              </div>
            </>
          ) : null}
        </div>
      </main>

      <Copilot projectSlug={projectSlug} nodeKind="users" cards={copilotCards} pending={stage.kind === 'analyzing'}
        extraSlot={stage.kind === 'done' ? <NodeFollowUpsSection projectSlug={projectSlug} nodeKind="users" content={(stage.analysis) as unknown as Record<string, unknown>} /> : null}
      />
    </div>
  );
}

function NodeHat({ chip }: { chip?: string } = {}) {
  return (
    <div className="node-hat">
      <span className="node-hat-num">{formatNodeNum('users')}</span>
      <span className="node-hat-rule" />
      <span className="node-hat-chip">{chip ?? 'JTBD · 预计 25 分钟'}</span>
    </div>
  );
}

function stageChip(stage: Stage): string {
  if (stage.kind === 'idle') return 'JTBD · 预计 25 分钟';
  if (stage.kind === 'analyzing') return '分析中…';
  return '已分析 · 可继续生成 / 锁定';
}

function BriefContext({ brief, cached }: { brief: BriefExtraction; cached: CachedBrief | null }) {
  const f = brief.fields;
  const highlightCounts = {
    fact: brief.highlights.filter((h) => h.kind === 'fact').length,
    assumption: brief.highlights.filter((h) => h.kind === 'assumption').length,
    missing: brief.highlights.filter((h) => h.kind === 'missing').length,
  };
  return (
    <div className="para-section">
      <details className="ctx-card">
        <summary>
          BRIEF 上下文快照 · 完整度 {brief.completeness}% · {highlightCounts.fact} 事实 · {highlightCounts.assumption} 假设 · {highlightCounts.missing} 缺失
        </summary>
        <div className="ctx-body">
          <div className="ctx-grid">
            <div><b>问题陈述</b></div>
            <div>{f.problem_statement ?? <span className="placeholder">未定义</span>}</div>

            <div><b>目标用户</b></div>
            <div>{f.target_user ?? <span className="placeholder">未定义</span>}</div>

            <div><b>使用场景</b></div>
            <div>{f.scenario ?? <span className="placeholder">未定义</span>}</div>

            <div><b>价值主张</b></div>
            <div>{f.value_prop ?? <span className="placeholder">未定义</span>}</div>

            <div><b>成功标准</b></div>
            <div>{f.success_criteria ?? <span className="placeholder">未定义</span>}</div>

            <div><b>时间约束</b></div>
            <div>{f.time_constraint ?? <span className="placeholder">未定义</span>}</div>

            <div><b>明确边界</b></div>
            <div>
              {(f.boundaries ?? []).length > 0
                ? (f.boundaries ?? []).map((b, i) => (
                    <span key={i} className="tag tag-not" style={{ marginRight: 4 }}>{b}</span>
                  ))
                : <span className="placeholder">未定义</span>}
            </div>

            {f.red_lines && f.red_lines.length > 0 ? (
              <>
                <div><b>道德红线</b></div>
                <div>
                  {f.red_lines.map((r, i) => (
                    <span key={i} className="tag" style={{ marginRight: 4, background: 'var(--missing)', color: 'var(--danger)' }}>⚠ {r}</span>
                  ))}
                </div>
              </>
            ) : null}
          </div>

          {cached?.answers && cached.answers.length > 0 ? (
            <div className="ctx-section">
              <div className="ctx-section-title">澄清回答 · {cached.answers.length} 条</div>
              {cached.answers.map((a, i) => (
                <div key={i} className="ctx-qa">
                  <div className="ctx-q">{a.question}</div>
                  <div className="ctx-a">
                    {Array.isArray(a.answer) ? a.answer.join(' · ') : a.answer}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {brief.follow_ups.length > 0 ? (
            <div className="ctx-section">
              <div className="ctx-section-title">AI 仍在追问 · {brief.follow_ups.length} 条</div>
              {brief.follow_ups.map((q, i) => (
                <div key={i} className="ctx-qa">
                  <div className="ctx-q">{q.question}</div>
                  {q.why ? <div className="ctx-why">{q.why}</div> : null}
                </div>
              ))}
            </div>
          ) : null}

          {cached?.raw_text ? (
            <details className="ctx-section ctx-raw">
              <summary>原始需求文字 · {cached.raw_text.length} 字</summary>
              <div className="ctx-raw-body">{cached.raw_text}</div>
            </details>
          ) : null}
        </div>
      </details>
    </div>
  );
}

function PersonaGrid({
  personas,
  locked,
  onLock,
  onRemove,
}: {
  personas: Persona[];
  locked: Record<string, boolean>;
  onLock: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="persona-grid">
      {personas.map((p) => {
        const isLocked = !!locked[p.id];
        return (
          <div
            key={p.id}
            className={`persona-tile ${isLocked ? 'locked' : ''}`}
          >
            <div className="persona-tile-top">
              <div className={`persona-tile-role ${isLocked ? 'on' : ''}`}>
                {isLocked ? '✓ 已选' : '未选'}
              </div>
              <div className="persona-tile-name">{p.name}</div>
              {p.role === 'primary' ? (
                <span className="persona-tile-hint-badge" title="AI 认为这是最典型的主用户">AI 推荐</span>
              ) : null}
              <div className="persona-tile-actions">
                <button
                  type="button"
                  className={`persona-tile-btn lock ${isLocked ? 'on' : ''}`}
                  onClick={() => onLock(p.id)}
                  title={isLocked ? '取消锁定' : '锁定这个 persona'}
                >
                  {isLocked ? '★' : '☆'}
                </button>
                {!isLocked ? (
                  <button
                    type="button"
                    className="persona-tile-btn remove"
                    onClick={() => onRemove(p.id)}
                    title="移除"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            </div>
            <div className="persona-tile-body">
              <div className="persona-tile-one-liner">{p.one_liner}</div>
              <div className="persona-tile-meta">{p.meta}</div>
              <div className="persona-tile-story">{p.story}</div>
              <div className="persona-tile-pain">{p.pain}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function JobsRefreshBar({
  currentSelection,
  jobsBasedOn,
  personas,
  locked,
  refreshing,
  onRefresh,
}: {
  currentSelection: string[];
  jobsBasedOn?: string[];
  personas: Persona[];
  locked: Record<string, boolean>;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const basis = jobsBasedOn ?? [];
  const stale =
    currentSelection.length > 0 &&
    (currentSelection.length !== basis.length ||
      currentSelection.some((id, i) => id !== basis[i]));
  const selectedCount = currentSelection.length;
  const selectedNames = personas
    .filter((p) => locked[p.id])
    .map((p) => p.name.split(' · ')[0])
    .join('、');

  return (
    <div className={`jobs-refresh-bar ${stale ? 'stale' : ''}`}>
      <div className="jobs-refresh-info">
        {stale ? (
          <>
            <span className="jobs-refresh-dot" />
            <b>画像选择已变 —— </b>
            Jobs 可能没覆盖新选的 persona 或还留着不相关的。建议刷新。
          </>
        ) : selectedCount === 0 ? (
          <span className="dim">没有已选 persona —— 请先至少选 1 个</span>
        ) : (
          <>
            当前 Jobs 基于 <b>{selectedCount} 个已选 persona</b>（{selectedNames}）推导。
          </>
        )}
      </div>
      <button
        type="button"
        className={stale ? 'btn btn-accent' : 'btn btn-ghost'}
        onClick={onRefresh}
        disabled={refreshing || selectedCount === 0}
        title="基于当前已选 persona 重新推导 Jobs 清单"
      >
        {refreshing ? (
          <><span className="ai-spinner" />&nbsp; 刷新中</>
        ) : stale ? (
          `⟳ 基于 ${selectedCount} 个 persona 刷新 Jobs`
        ) : (
          '⟳ 重新刷新'
        )}
      </button>
    </div>
  );
}

function JobGroup({
  group,
  jobs,
  locked,
  personas,
  onToggle,
}: {
  group: 'functional' | 'emotional' | 'social';
  jobs: Job[];
  locked: Record<string, boolean>;
  personas: Persona[];
  onToggle: (id: string) => void;
}) {
  const meta = GROUP_META[group];
  const lockedCount = jobs.filter((j) => locked[j.id]).length;
  if (jobs.length === 0) return null;
  const personaName = (id: string) => {
    const p = personas.find((x) => x.id === id);
    if (!p) return id;
    return p.name.split(' · ')[0];
  };
  return (
    <div className="job-group">
      <div className="job-group-head">
        <span className="job-group-title">{meta.label}</span>
        <span className={`job-group-tag ${group}`}>{meta.tag}</span>
        <span className="job-group-sub">{meta.hint} · {lockedCount} / {jobs.length} 已锁定</span>
      </div>
      {jobs
        .slice()
        .sort((a, b) => b.reach * b.impact - a.reach * a.impact)
        .map((j) => {
          const isLocked = !!locked[j.id];
          const personaIds = j.persona_ids ?? [];
          return (
            <label key={j.id} className={`job-row ${isLocked ? 'locked' : ''}`}>
              <input type="checkbox" checked={isLocked} onChange={() => onToggle(j.id)} />
              <div>
                <div className="job-row-title">
                  {j.title}
                  {j.suggested_priority ? <span className="suggested-badge">AI 建议</span> : null}
                </div>
                <div className="job-row-source">
                  {j.source}
                  {personaIds.length > 0 ? (
                    <span className="job-row-personas">
                      {personaIds.map((pid) => (
                        <span key={pid} className="job-persona-chip">{personaName(pid)}</span>
                      ))}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className="job-row-score">
                <span>R{j.reach}</span>
                <span>I{j.impact}</span>
              </div>
              <div className="job-row-ri">{j.reach * j.impact}</div>
            </label>
          );
        })}
    </div>
  );
}

function LockedSummary({
  analysis,
  locked,
}: {
  analysis: UsersAnalysis;
  locked: Record<string, boolean>;
}) {
  const picks = (['functional', 'emotional', 'social'] as const).map((g) => {
    const chosen = analysis.jobs[g].filter((j) => locked[j.id]);
    return { group: g, jobs: chosen };
  });
  const total = picks.reduce((a, p) => a + p.jobs.length, 0);
  if (total === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">还没有锁定任何 Job</div>
        <p>勾选至少每类 1 个——它们将在后续节点里成为产品聚焦点。</p>
      </div>
    );
  }
  return (
    <div className="brief-form">
      {picks.map(({ group, jobs }) =>
        jobs.length > 0 ? (
          <div className="brief-row" key={group}>
            <div className="brief-label">
              {GROUP_META[group].label}
              <small>{jobs.length} 条</small>
            </div>
            <div className="brief-value">
              {jobs.map((j) => (
                <div key={j.id} style={{ marginBottom: 4 }}>
                  <span className="ai-filled">{j.title}</span>
                  <span className="dim" style={{ fontSize: 11, fontFamily: 'var(--mono)', marginLeft: 8 }}>
                    R{j.reach}·I{j.impact} · {j.source}
                  </span>
                </div>
              ))}
            </div>
            <div className="brief-status filled">✓</div>
          </div>
        ) : null,
      )}
    </div>
  );
}
