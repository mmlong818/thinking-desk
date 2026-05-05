'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { NodeFollowUpsSection } from '@/components/shared/NodeFollowUpsSection';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/tasks/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/tasks/analyze-users';
import type {
  EngagementPlan,
  Stakeholder,
  StakeholdersAnalysis,
} from '@/lib/ai/tasks/analyze-stakeholders';
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

type Quadrant = 'manage' | 'satisfy' | 'inform' | 'monitor';

const QUADRANT_META: Record<
  Quadrant,
  { title: string; subtitle: string; hint: string }
> = {
  manage: { title: '重点管理', subtitle: 'Manage Closely', hint: '高权力 · 高关心 → 深度共创' },
  satisfy: { title: '保持满意', subtitle: 'Keep Satisfied', hint: '高权力 · 低关心 → 重点汇报' },
  inform: { title: '保持告知', subtitle: 'Keep Informed', hint: '低权力 · 高关心 → 信息同步' },
  monitor: { title: '最低力度', subtitle: 'Monitor', hint: '低权力 · 低关心 → 定期扫描' },
};

const CATEGORY_LABEL: Record<Stakeholder['category'], string> = {
  sponsor: '发起人',
  maker: '设计/产品',
  business: '业务方',
  user: '用户',
  compliance: '合规',
  partner: '合作方',
  competitor: '竞品',
  other: '其他',
};

function quadrantOf(s: Stakeholder): Quadrant {
  if (s.power === 'high' && s.interest === 'high') return 'manage';
  if (s.power === 'high' && s.interest === 'low') return 'satisfy';
  if (s.power === 'low' && s.interest === 'high') return 'inform';
  return 'monitor';
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'analyzing' }
  | {
      kind: 'done';
      stakeholders: Stakeholder[];
      selected: Record<string, boolean>;
      engagement_plan: EngagementPlan;
      priority_summary: string;
      critiques: StakeholdersAnalysis['critiques'];
    };

interface Props {
  projectSlug: string;
  brief: BriefExtraction | null;
  usersContent: CachedUsers | null;
  initial?: StakeholdersAnalysis & { selected?: Record<string, boolean> };
}

export function StakeholdersNode({
  projectSlug,
  brief: briefFromServer,
  usersContent,
  initial,
}: Props) {
  const router = useRouter();
  const [brief, setBrief] = useState<BriefExtraction | null>(briefFromServer);
  const [cachedBrief, setCachedBrief] = useState<CachedBrief | null>(null);
  const [cachedUsers, setCachedUsers] = useState<CachedUsers | null>(usersContent);

  // Fall back to sessionStorage when server DB didn't hydrate everything.
  useEffect(() => {
    if (!brief) {
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
    }
    if (!cachedUsers) {
      const cached = readCache<CachedUsers>(projectSlug, 'users');
      if (cached) setCachedUsers(cached);
    }
  }, [brief, cachedUsers, projectSlug]);

  const [stage, setStage] = useState<Stage>(() => {
    if (initial) {
      const selected: Record<string, boolean> = initial.selected ?? {};
      if (Object.keys(selected).length === 0) {
        // Default selection: all required + anything in "manage" quadrant
        for (const s of initial.stakeholders) {
          if (s.required || quadrantOf(s) === 'manage') selected[s.id] = true;
        }
      }
      return {
        kind: 'done',
        stakeholders: initial.stakeholders,
        selected,
        engagement_plan: initial.engagement_plan,
        priority_summary: initial.priority_summary,
        critiques: initial.critiques,
      };
    }
    return { kind: 'idle' };
  });
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();

  // Restore from users-ui style cache on mount so navigation back keeps state.
  useEffect(() => {
    if (stage.kind !== 'idle') return;
    const cached = readCache<Partial<Extract<Stage, { kind: 'done' }>>>(
      projectSlug,
      'stake-ui',
    );
    if (!cached || cached.kind !== 'done' || !cached.stakeholders) return;
    const restored: Extract<Stage, { kind: 'done' }> = {
      kind: 'done',
      stakeholders: cached.stakeholders,
      selected: cached.selected ?? {},
      engagement_plan:
        cached.engagement_plan ?? { manage: '', satisfy: '', inform: '', monitor: '' },
      priority_summary: cached.priority_summary ?? '',
      critiques: cached.critiques ?? [],
    };
    setStage(restored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  const persistDone = (next: Extract<Stage, { kind: 'done' }>) => {
    writeCache(projectSlug, 'stake-ui', next);
    writeCache(projectSlug, 'stake', {
      stakeholders: next.stakeholders,
      engagement_plan: next.engagement_plan,
      priority_summary: next.priority_summary,
      critiques: next.critiques,
      selected: next.selected,
    });
  };

  // Helpers: extract selected personas / locked jobs from cached users node.
  const selectedPersonasFromUsers = (): Persona[] => {
    if (!cachedUsers) return [];
    const all = [...cachedUsers.personas, ...(cachedUsers.extraPersonas ?? [])];
    const locked = cachedUsers.personaLocked ?? {};
    return all.filter((p) => locked[p.id]);
  };
  const lockedJobsFromUsers = (): Job[] => {
    if (!cachedUsers) return [];
    const locked = cachedUsers.jobLocked ?? {};
    const all = [
      ...cachedUsers.jobs.functional,
      ...cachedUsers.jobs.emotional,
      ...cachedUsers.jobs.social,
    ];
    return all.filter((j) => locked[j.id]);
  };

  const analyze = () => {
    setError(null);
    const prevSelected = stage.kind === 'done' ? stage.selected : {};
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
        const personas = selectedPersonasFromUsers();
        const lockedJobs = lockedJobsFromUsers();
        if (personas.length > 0) payload.personas = personas;
        if (lockedJobs.length > 0) payload.lockedJobs = lockedJobs;

        const res = await fetch('/api/ai/analyze-stakeholders', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          data?: StakeholdersAnalysis;
          error?: string;
          detail?: string;
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '分析失败');
        }
        const selected: Record<string, boolean> = {};
        for (const s of json.data.stakeholders) {
          // Required stakeholders are always selected. Prior user choice wins
          // for non-required ids. Anything new in "manage" quadrant defaults on.
          if (s.required) {
            selected[s.id] = true;
          } else if (Object.prototype.hasOwnProperty.call(prevSelected, s.id)) {
            selected[s.id] = prevSelected[s.id];
          } else if (quadrantOf(s) === 'manage') {
            selected[s.id] = true;
          } else {
            selected[s.id] = false;
          }
        }
        const next: Extract<Stage, { kind: 'done' }> = {
          kind: 'done',
          stakeholders: json.data.stakeholders,
          selected,
          engagement_plan: json.data.engagement_plan,
          priority_summary: json.data.priority_summary,
          critiques: json.data.critiques,
        };
        persistDone(next);
        setStage(next);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'idle' });
      }
    });
  };

  const toggleSelect = (id: string) => {
    if (stage.kind !== 'done') return;
    const target = stage.stakeholders.find((s) => s.id === id);
    if (!target || target.required) return; // required 不可取消
    const next: Extract<Stage, { kind: 'done' }> = {
      ...stage,
      selected: { ...stage.selected, [id]: !stage.selected[id] },
    };
    persistDone(next);
    setStage(next);
  };

  const removeStakeholder = (id: string) => {
    if (stage.kind !== 'done') return;
    const target = stage.stakeholders.find((s) => s.id === id);
    if (!target || target.required) return;
    const next: Extract<Stage, { kind: 'done' }> = {
      ...stage,
      stakeholders: stage.stakeholders.filter((s) => s.id !== id),
      selected: Object.fromEntries(
        Object.entries(stage.selected).filter(([k]) => k !== id),
      ),
    };
    persistDone(next);
    setStage(next);
  };

  const grouped = useMemo(() => {
    if (stage.kind !== 'done') return null;
    const by: Record<Quadrant, Stakeholder[]> = {
      manage: [],
      satisfy: [],
      inform: [],
      monitor: [],
    };
    for (const s of stage.stakeholders) by[quadrantOf(s)].push(s);
    return by;
  }, [stage]);

  const copilotCards = useMemo<CopilotCard[]>(() => {
    if (!brief) {
      return [
        {
          tag: 'check',
          title: '等 Brief 和用户节点完成',
          body: '干系人分析需要前两个节点的产出。请先完成 Brief 和用户与任务节点。',
        },
      ];
    }
    if (stage.kind === 'idle') {
      const personas = selectedPersonasFromUsers();
      const jobs = lockedJobsFromUsers();
      return [
        {
          tag: 'feed',
          title: '准备好做 Mendelow 分析',
          body: (
            <>
              我会读 Brief 上下文，以及你在用户与任务节点锁定的{' '}
              <b>{personas.length} 个 persona</b> 和 <b>{jobs.length} 个 Job</b>，
              产出 8–12 个干系人，<em>其中 5 个基线角色（发起人 / 设计团队 / 业务方 / 合规 / 用户）必选不可删</em>，
              其余按 Brief 推导。
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
          body: '通常 30–60 秒。要判断每个干系人在权力×关心二维上的位置。',
        },
      ];
    }
    const cards: CopilotCard[] = [
      {
        tag: 'feed',
        title: `识别到 ${stage.stakeholders.length} 个干系人`,
        body: stage.priority_summary,
      },
    ];
    for (const c of stage.critiques) {
      cards.push({ tag: c.kind, title: c.title, body: c.body });
    }
    return cards;
  }, [stage, brief, cachedUsers]);

  if (!brief) {
    return (
      <div className="main">
        <main className="work">
          <div className="work-inner">
            <NodeHat />
            <h1 className="node-title">干系人：谁会推动你、谁会阻挡你</h1>
            <p className="node-intro">
              这个节点需要 Brief 和用户与任务节点都完成。
            </p>
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-state-title">缺少前置节点</div>
              <p>
                先完成{' '}
                <Link href={`/project/${projectSlug}/brief`} style={{ color: 'var(--accent)' }}>
                  Brief
                </Link>{' '}
                和{' '}
                <Link href={`/project/${projectSlug}/users`} style={{ color: 'var(--accent)' }}>
                  用户与任务
                </Link>
                ，再回来。
              </p>
            </div>
          </div>
        </main>
        <Copilot projectSlug={projectSlug} nodeKind="stake" cards={copilotCards} />
      </div>
    );
  }

  return (
    <div className="main">
      <main className="work wide">
        <div className="work-inner">
          <NodeHat chip={stageChip(stage)} />
          <h1 className="node-title">干系人：谁会推动你、谁会阻挡你</h1>
          <p className="node-intro">
            每个项目都有<em>显性和隐性的干系人</em>。我把他们放进 Mendelow 2×2 矩阵，
            其中<em>基线角色</em>（发起人、设计团队、你背后的业务方、合规、用户）<em>始终必选不可删</em>，
            项目专属的干系人你可以自由调整。
          </p>

          <UpstreamContext brief={brief} users={cachedUsers} />

          {stage.kind === 'idle' ? (
            <div className="para-section" style={{ display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="btn btn-accent" onClick={analyze}>
                基于 Brief + 用户节点开始分析 →
              </button>
            </div>
          ) : null}

          {stage.kind === 'analyzing' ? (
            <div className="para-section">
              <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                <span className="ai-spinner" />
                &nbsp; 正在拆解 Mendelow 矩阵，通常 30–60 秒……
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              className="cop-card"
              style={{ marginTop: 14, borderColor: 'var(--danger)', color: 'var(--danger)' }}
            >
              <div className="cop-card-title">调用失败</div>
              <div className="cop-card-body" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                {error}
              </div>
            </div>
          ) : null}

          {stage.kind === 'done' && grouped ? (
            <>
              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">Mendelow 2×2 矩阵</span>
                  <span className="para-h-hint">
                    {stage.stakeholders.length} 个 ·{' '}
                    {Object.values(stage.selected).filter(Boolean).length} 已选 ·{' '}
                    {stage.stakeholders.filter((s) => s.required).length} 基线必选
                  </span>
                </div>
                <MendelowMatrix
                  grouped={grouped}
                  selected={stage.selected}
                  onToggle={toggleSelect}
                  onRemove={removeStakeholder}
                />
              </div>

              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">干系人详情</span>
                  <span className="para-h-hint">完整信息 · 可删除非必选</span>
                </div>
                <StakeholderList
                  stakeholders={stage.stakeholders}
                  selected={stage.selected}
                  onToggle={toggleSelect}
                  onRemove={removeStakeholder}
                />
              </div>

              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">四象限沟通节奏</span>
                  <span className="para-h-hint">AI 建议 · 可在评审里调整</span>
                </div>
                <EngagementPlanCards plan={stage.engagement_plan} />
              </div>

              <div className="para-section" style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => {
                    const next = nextNodeKind('stake');
                    if (next) router.push(`/project/${projectSlug}/${next}`);
                  }}
                >
                  继续 · 04 替代方案 →
                </button>
                <button type="button" className="btn btn-ghost" onClick={analyze}>
                  重新分析
                </button>
              </div>
            </>
          ) : null}
        </div>
      </main>

      <Copilot projectSlug={projectSlug} nodeKind="stake" cards={copilotCards} pending={stage.kind === 'analyzing'}
        extraSlot={stage.kind === 'done' ? <NodeFollowUpsSection projectSlug={projectSlug} nodeKind="stake" content={({ stakeholders: stage.stakeholders, engagement_plan: stage.engagement_plan, priority_summary: stage.priority_summary, critiques: stage.critiques }) as unknown as Record<string, unknown>} /> : null}
      />
    </div>
  );
}

function NodeHat({ chip }: { chip?: string } = {}) {
  return (
    <div className="node-hat">
      <span className="node-hat-num">{formatNodeNum('stake')}</span>
      <span className="node-hat-rule" />
      <span className="node-hat-chip">{chip ?? 'Mendelow 矩阵 · 预计 20 分钟'}</span>
    </div>
  );
}

function stageChip(stage: Stage): string {
  if (stage.kind === 'idle') return 'Mendelow 矩阵 · 预计 20 分钟';
  if (stage.kind === 'analyzing') return '分析中…';
  return '已分析 · 可编辑 / 选择';
}

function UpstreamContext({
  brief,
  users,
}: {
  brief: BriefExtraction;
  users: CachedUsers | null;
}) {
  const f = brief.fields;
  const selectedPersonas = users
    ? [...users.personas, ...(users.extraPersonas ?? [])].filter(
        (p) => users.personaLocked?.[p.id],
      )
    : [];
  const lockedJobCount = users
    ? Object.values(users.jobLocked ?? {}).filter(Boolean).length
    : 0;
  return (
    <div className="para-section">
      <details className="ctx-card">
        <summary>
          上游上下文 · Brief {brief.completeness}% · {selectedPersonas.length} personas ·{' '}
          {lockedJobCount} jobs
        </summary>
        <div className="ctx-body">
          <div className="ctx-grid">
            <div><b>问题</b></div>
            <div>{f.problem_statement ?? <span className="placeholder">未定义</span>}</div>
            <div><b>用户</b></div>
            <div>{f.target_user ?? <span className="placeholder">未定义</span>}</div>
            <div><b>场景</b></div>
            <div>{f.scenario ?? <span className="placeholder">未定义</span>}</div>
            <div><b>价值主张</b></div>
            <div>{f.value_prop ?? <span className="placeholder">未定义</span>}</div>
          </div>
          {selectedPersonas.length > 0 ? (
            <div className="ctx-section">
              <div className="ctx-section-title">已选 personas · {selectedPersonas.length} 个</div>
              {selectedPersonas.map((p) => (
                <div key={p.id} className="ctx-qa">
                  <div className="ctx-q">{p.name}</div>
                  <div className="ctx-why">{p.one_liner}</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="ctx-section">
              <div className="ctx-section-title" style={{ color: 'var(--warn)' }}>
                尚未在用户节点锁定 persona
              </div>
              <div className="ctx-why">AI 会退化到基于 Brief 推断基线干系人。</div>
            </div>
          )}
        </div>
      </details>
    </div>
  );
}

function MendelowMatrix({
  grouped,
  selected,
  onToggle,
  onRemove,
}: {
  grouped: Record<Quadrant, Stakeholder[]>;
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="mendelow">
      <div className="mendelow-y-label">
        <span>高</span>
        <span>← 权力 →</span>
        <span>低</span>
      </div>
      <div className="mendelow-grid">
        <Cell quadrant="satisfy" items={grouped.satisfy} selected={selected} onToggle={onToggle} onRemove={onRemove} />
        <Cell quadrant="manage" items={grouped.manage} selected={selected} onToggle={onToggle} onRemove={onRemove} />
        <Cell quadrant="monitor" items={grouped.monitor} selected={selected} onToggle={onToggle} onRemove={onRemove} />
        <Cell quadrant="inform" items={grouped.inform} selected={selected} onToggle={onToggle} onRemove={onRemove} />
      </div>
      <div className="mendelow-x-label">
        <span>低</span>
        <span>关心程度 →</span>
        <span>高</span>
      </div>
    </div>
  );
}

function Cell({
  quadrant,
  items,
  selected,
  onToggle,
  onRemove,
}: {
  quadrant: Quadrant;
  items: Stakeholder[];
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const meta = QUADRANT_META[quadrant];
  return (
    <div className={`mendelow-cell q-${quadrant}`}>
      <div className="mendelow-cell-head">
        <span className="mendelow-cell-title">{meta.title}</span>
        <span className="mendelow-cell-sub">{meta.subtitle}</span>
      </div>
      <div className="mendelow-cell-hint">{meta.hint}</div>
      <div className="mendelow-cell-items">
        {items.length === 0 ? (
          <div className="mendelow-cell-empty">（此象限暂无）</div>
        ) : (
          items.map((s) => (
            <StakeholderChip
              key={s.id}
              stakeholder={s}
              isSelected={!!selected[s.id]}
              onToggle={onToggle}
              onRemove={onRemove}
            />
          ))
        )}
      </div>
    </div>
  );
}

function StakeholderChip({
  stakeholder: s,
  isSelected,
  onToggle,
  onRemove,
}: {
  stakeholder: Stakeholder;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div
      className={`stake-chip ${isSelected ? 'selected' : ''} ${s.required ? 'required' : ''}`}
      title={s.note}
    >
      <button
        type="button"
        className="stake-chip-main"
        onClick={() => onToggle(s.id)}
        disabled={s.required}
      >
        <span className="stake-chip-mark">
          {s.required ? '🔒' : isSelected ? '✓' : '○'}
        </span>
        <span className="stake-chip-name">{s.name}</span>
      </button>
      {!s.required ? (
        <button
          type="button"
          className="stake-chip-remove"
          onClick={() => onRemove(s.id)}
          title="删除"
        >
          ×
        </button>
      ) : null}
    </div>
  );
}

function StakeholderList({
  stakeholders,
  selected,
  onToggle,
  onRemove,
}: {
  stakeholders: Stakeholder[];
  selected: Record<string, boolean>;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const sorted = [...stakeholders].sort((a, b) => {
    if (a.required !== b.required) return a.required ? -1 : 1;
    const pw = (x: Stakeholder) => (x.power === 'high' ? 0 : 1);
    const iw = (x: Stakeholder) => (x.interest === 'high' ? 0 : 1);
    return pw(a) + iw(a) - (pw(b) + iw(b));
  });
  return (
    <div className="stake-list">
      {sorted.map((s) => {
        const isSel = !!selected[s.id];
        return (
          <div key={s.id} className={`stake-row ${isSel ? 'selected' : ''} ${s.required ? 'required' : ''}`}>
            <button
              type="button"
              className={`persona-tile-btn lock ${isSel ? 'on' : ''}`}
              onClick={() => onToggle(s.id)}
              disabled={s.required}
              title={s.required ? '基线角色 · 必选' : isSel ? '取消选择' : '选入聚焦清单'}
            >
              {s.required ? '🔒' : isSel ? '★' : '☆'}
            </button>
            <div>
              <div className="stake-row-head">
                <span className="stake-row-name">{s.name}</span>
                <span className={`stake-row-cat cat-${s.category}`}>
                  {CATEGORY_LABEL[s.category]}
                </span>
                <span className={`stake-row-quad q-${quadrantOf(s)}`}>
                  {QUADRANT_META[quadrantOf(s)].title}
                </span>
                {s.required ? <span className="suggested-badge">基线 · 必选</span> : null}
              </div>
              <div className="stake-row-role">{s.role}</div>
              <div className="stake-row-note">{s.note}</div>
              {s.engagement_hint ? (
                <div className="stake-row-hint">
                  <b>如何对待</b>：{s.engagement_hint}
                </div>
              ) : null}
              <div className="stake-row-source">来源：{s.source}</div>
            </div>
            <div>
              {!s.required ? (
                <button
                  type="button"
                  className="persona-tile-btn remove"
                  onClick={() => onRemove(s.id)}
                >
                  ×
                </button>
              ) : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function EngagementPlanCards({ plan }: { plan: EngagementPlan }) {
  const items: { key: Quadrant; text: string }[] = [
    { key: 'manage', text: plan.manage },
    { key: 'satisfy', text: plan.satisfy },
    { key: 'inform', text: plan.inform },
    { key: 'monitor', text: plan.monitor },
  ];
  return (
    <div className="engagement-cards">
      {items.map((it) => {
        const meta = QUADRANT_META[it.key];
        return (
          <div key={it.key} className={`engagement-card q-${it.key}`}>
            <div className="engagement-card-head">
              <span>{meta.title}</span>
              <span className="engagement-card-sub">{meta.subtitle}</span>
            </div>
            <div className="engagement-card-body">{it.text}</div>
          </div>
        );
      })}
    </div>
  );
}
