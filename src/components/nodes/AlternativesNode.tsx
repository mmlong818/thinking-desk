'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { NodeFollowUpsSection } from '@/components/shared/NodeFollowUpsSection';
import { EditableTextarea, EditableList } from '@/components/shared/Editable';
import type { BriefExtraction, ClarificationAnswer } from '@/lib/ai/tasks/extract-brief';
import type { Persona, Job, UsersAnalysis } from '@/lib/ai/tasks/analyze-users';
import type {
  Alternative,
  AlternativesAnalysis,
  StrategicProfile,
  FeatureBreakdown,
} from '@/lib/ai/tasks/analyze-alternatives';
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

const CATEGORY_META: Record<
  Alternative['category'],
  { label: string; sub: string; hint: string; cls: string }
> = {
  direct: {
    label: '直接替代',
    sub: 'Direct',
    hint: '同品类 · 同目标用户 · 表面对手',
    cls: 'direct',
  },
  indirect: {
    label: '间接替代',
    sub: 'Indirect',
    hint: '不同品类 · 相同 Job',
    cls: 'indirect',
  },
  non_consumption: {
    label: '非消费替代',
    sub: 'Non-consumption',
    hint: '★ 真正的对手 · 用户干脆不解决这个问题',
    cls: 'nonc',
  },
};

const THREAT_META: Record<Alternative['threat_level'], { label: string; cls: string }> = {
  high: { label: '高威胁', cls: 'high' },
  medium: { label: '中威胁', cls: 'medium' },
  low: { label: '低威胁', cls: 'low' },
};

const MOAT_META: Record<StrategicProfile['moat_strength'], { label: string; cls: string }> = {
  strong: { label: '难逾越', cls: 'strong' },
  medium: { label: '可逾越', cls: 'medium' },
  weak: { label: '弱', cls: 'weak' },
};

type Stage =
  | { kind: 'idle' }
  | { kind: 'analyzing' }
  | { kind: 'done'; analysis: AlternativesAnalysis };

interface Props {
  projectSlug: string;
  brief: BriefExtraction | null;
  usersContent: CachedUsers | null;
  initial?: AlternativesAnalysis;
}

export function AlternativesNode({
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

  const [stage, setStage] = useState<Stage>(() =>
    initial ? { kind: 'done', analysis: initial } : { kind: 'idle' },
  );
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();

  useEffect(() => {
    if (stage.kind !== 'idle') return;
    const cached = readCache<AlternativesAnalysis>(projectSlug, 'alt');
    if (cached && cached.alternatives) setStage({ kind: 'done', analysis: cached });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  const patchAnalysis = (mut: Partial<AlternativesAnalysis>) => {
    if (stage.kind !== 'done') return;
    const next = { ...stage.analysis, ...mut };
    setStage({ kind: 'done', analysis: next });
    writeCache(projectSlug, 'alt', next);
  };

  const selectedPersonas = useMemo((): Persona[] => {
    if (!cachedUsers) return [];
    const all = [...cachedUsers.personas, ...(cachedUsers.extraPersonas ?? [])];
    const locked = cachedUsers.personaLocked ?? {};
    return all.filter((p) => locked[p.id]);
  }, [cachedUsers]);

  const lockedJobs = useMemo((): Job[] => {
    if (!cachedUsers) return [];
    const locked = cachedUsers.jobLocked ?? {};
    return [
      ...cachedUsers.jobs.functional,
      ...cachedUsers.jobs.emotional,
      ...cachedUsers.jobs.social,
    ].filter((j) => locked[j.id]);
  }, [cachedUsers]);

  const analyze = () => {
    setError(null);
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
        if (selectedPersonas.length > 0) payload.personas = selectedPersonas;
        if (lockedJobs.length > 0) payload.lockedJobs = lockedJobs;

        const res = await fetch('/api/ai/analyze-alternatives', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          data?: AlternativesAnalysis;
          error?: string;
          detail?: string;
        };
        if (!res.ok || !json.ok || !json.data) {
          throw new Error(json.detail ?? json.error ?? '分析失败');
        }
        writeCache(projectSlug, 'alt', json.data);
        setStage({ kind: 'done', analysis: json.data });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'idle' });
      }
    });
  };

  const copilotCards = useMemo<CopilotCard[]>(() => {
    if (!brief) {
      return [
        {
          tag: 'check',
          title: '需要 Brief 上下文',
          body: '请先完成 Brief 节点，替代方案节点才能运作。',
        },
      ];
    }
    if (stage.kind === 'idle') {
      return [
        {
          tag: 'feed',
          title: '准备好做 §7 替代方案扫描',
          body: (
            <>
              我会<em>联网搜索</em>查找真实的直接 / 间接替代品，并推理 <em>非消费替代</em>
              （用户懒得解决这个问题的各种方式）。<br />
              然后对重点对手按 <em>战略三问</em>（承诺 / 赢利模式 / 护城河）做深度画像，
              最后给你一句"差异化假设"。通常 <b>60-120 秒</b>。
            </>
          ),
        },
      ];
    }
    if (stage.kind === 'analyzing') {
      return [
        {
          tag: 'feed',
          title: '联网扫描中…',
          body: '正在检索真实产品信息。这步比较慢，AI 要读多个网页，通常 1-2 分钟。',
        },
      ];
    }
    const cards: CopilotCard[] = [
      {
        tag: 'feed',
        title: `识别到 ${stage.analysis.alternatives.length} 个替代方案`,
        body: (
          <>
            其中 <b>{stage.analysis.alternatives.filter((a) => a.category === 'non_consumption').length} 条
            非消费替代</b>——方法论说这些才是真正的对手。
            前 3 威胁：{stage.analysis.key_threats.slice(0, 3).join(' · ')}
          </>
        ),
      },
      {
        tag: 'ask',
        title: '差异化假设就绪',
        body: (
          <>
            一句话版本：<b>{stage.analysis.differentiation_hypothesis}</b>
            <div className="dim" style={{ marginTop: 6, fontSize: 12 }}>
              这句话经得起"找 3 个没参与项目的同事念 10 秒然后用自己话复述"的测试吗？
            </div>
          </>
        ),
      },
    ];
    for (const c of stage.analysis.critiques) {
      cards.push({ tag: c.kind, title: c.title, body: c.body });
    }
    return cards;
  }, [stage, brief]);

  if (!brief) {
    return (
      <div className="main">
        <main className="work">
          <div className="work-inner">
            <NodeHat />
            <h1 className="node-title">替代方案：真正的对手常常不是直接竞品</h1>
            <div className="empty-state" style={{ marginTop: 40 }}>
              <div className="empty-state-title">缺少 Brief 上下文</div>
              <p>
                请先完成{' '}
                <Link href={`/project/${projectSlug}/brief`} style={{ color: 'var(--accent)' }}>
                  Brief
                </Link>
                ，可选择也完成{' '}
                <Link href={`/project/${projectSlug}/users`} style={{ color: 'var(--accent)' }}>
                  用户与任务
                </Link>
                （会让分析更精准）。
              </p>
            </div>
          </div>
        </main>
        <Copilot projectSlug={projectSlug} nodeKind="alt" cards={copilotCards} />
      </div>
    );
  }

  return (
    <div className="main">
      <main className="work wide">
        <div className="work-inner">
          <NodeHat chip={stageChip(stage)} />
          <h1 className="node-title">替代方案：真正的对手常常不是直接竞品</h1>
          <p className="node-intro">
            你的产品要打败的不只是<em>同品类对手</em>。最常被忽视的是<em>非消费替代</em>——
            用户干脆不解决这个问题、或用原始方式凑合（"懒得用"、"抄答案"、"问家长"）。
            我会联网扫描真实对手，并按 §7.2 战略三问（<em>承诺 / 赢利模式 / 护城河</em>）画像。
          </p>

          <UpstreamContext
            brief={brief}
            personaCount={selectedPersonas.length}
            jobCount={lockedJobs.length}
          />

          {stage.kind === 'idle' ? (
            <div className="para-section" style={{ display: 'flex', justifyContent: 'center' }}>
              <button type="button" className="btn btn-accent" onClick={analyze}>
                开始联网扫描 →
              </button>
            </div>
          ) : null}

          {stage.kind === 'analyzing' ? (
            <div className="para-section">
              <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                <span className="ai-spinner" />
                &nbsp; 正在联网扫描真实替代品（会读多个网页）· 通常 60-120 秒……
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

          {stage.kind === 'done' ? (
            <>
              {/* § 1 三类替代全景 */}
              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">三类替代全景</span>
                  <span className="para-h-hint">
                    {stage.analysis.alternatives.length} 个 · 非消费 ★ 最关键
                  </span>
                </div>
                <AlternativesOverview alternatives={stage.analysis.alternatives} />
              </div>

              {/* § 2 战略画像 */}
              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">重点对手战略画像</span>
                  <span className="para-h-hint">§7.2 战略三问 · {stage.analysis.strategic_profiles.length} 个</span>
                </div>
                <StrategicProfiles
                  alternatives={stage.analysis.alternatives}
                  profiles={stage.analysis.strategic_profiles}
                />
              </div>

              {/* § 3 功能拆解 */}
              {stage.analysis.feature_breakdowns.length > 0 ? (
                <div className="para-section">
                  <div className="para-h">

                    <span className="para-h-title">直接竞品功能拆解</span>
                    <span className="para-h-hint">
                      §7.3 四角度 · {stage.analysis.feature_breakdowns.length} 个
                    </span>
                  </div>
                  <FeatureBreakdowns
                    alternatives={stage.analysis.alternatives}
                    breakdowns={stage.analysis.feature_breakdowns}
                  />
                </div>
              ) : null}

              {/* § 4 威胁与差异化 */}
              <div className="para-section">
                <div className="para-h">

                  <span className="para-h-title">核心威胁 & 差异化假设</span>
                  <span className="para-h-hint">一句话说清凭什么赢</span>
                </div>
                <ThreatsAndDiff
                  threats={stage.analysis.key_threats}
                  hypothesis={stage.analysis.differentiation_hypothesis}
                  onPatch={patchAnalysis}
                />
              </div>

              <div className="para-section" style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  className="btn btn-accent"
                  onClick={() => {
                    const next = nextNodeKind('alt');
                    if (next) router.push(`/project/${projectSlug}/${next}`);
                  }}
                >
                  继续 · 05 情景 →
                </button>
                <button type="button" className="btn btn-ghost" onClick={analyze}>
                  重新扫描
                </button>
              </div>
            </>
          ) : null}
        </div>
      </main>

      <Copilot projectSlug={projectSlug} nodeKind="alt" cards={copilotCards} pending={stage.kind === 'analyzing'}
        extraSlot={stage.kind === 'done' ? <NodeFollowUpsSection projectSlug={projectSlug} nodeKind="alt" content={(stage.analysis) as unknown as Record<string, unknown>} /> : null}
      />
    </div>
  );
}

function NodeHat({ chip }: { chip?: string } = {}) {
  return (
    <div className="node-hat">
      <span className="node-hat-num">{formatNodeNum('alt')}</span>
      <span className="node-hat-rule" />
      <span className="node-hat-chip">{chip ?? '替代方案 · 预计 25 分钟'}</span>
    </div>
  );
}

function stageChip(stage: Stage): string {
  if (stage.kind === 'idle') return '替代方案 · 预计 25 分钟';
  if (stage.kind === 'analyzing') return '联网扫描中…';
  return '已扫描 · 可重跑';
}

function UpstreamContext({
  brief,
  personaCount,
  jobCount,
}: {
  brief: BriefExtraction;
  personaCount: number;
  jobCount: number;
}) {
  const f = brief.fields;
  return (
    <div className="para-section">
      <details className="ctx-card">
        <summary>
          上游快照 · Brief {brief.completeness}% · {personaCount} personas · {jobCount} jobs
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
        </div>
      </details>
    </div>
  );
}

function AlternativesOverview({ alternatives }: { alternatives: Alternative[] }) {
  const grouped: Record<Alternative['category'], Alternative[]> = {
    direct: [],
    indirect: [],
    non_consumption: [],
  };
  for (const a of alternatives) grouped[a.category].push(a);
  return (
    <div className="alt-overview">
      {(['non_consumption', 'direct', 'indirect'] as const).map((cat) => {
        const meta = CATEGORY_META[cat];
        const items = grouped[cat];
        return (
          <div key={cat} className={`alt-group alt-group-${meta.cls}`}>
            <div className="alt-group-head">
              <span className="alt-group-label">{meta.label}</span>
              <span className="alt-group-sub">{meta.sub}</span>
              <span className="alt-group-hint">{meta.hint}</span>
              <span className="alt-group-count">{items.length} 个</span>
            </div>
            {items.length === 0 ? (
              <div className="alt-empty">（此类没有识别到）</div>
            ) : (
              <div className="alt-list">
                {items.map((a) => (
                  <AltCard key={a.id} alternative={a} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function AltCard({ alternative: a }: { alternative: Alternative }) {
  const threat = THREAT_META[a.threat_level];
  return (
    <div className={`alt-card threat-${threat.cls}`}>
      <div className="alt-card-head">
        <span className="alt-card-name">{a.name}</span>
        <span className={`alt-threat ${threat.cls}`}>{threat.label}</span>
      </div>
      <div className="alt-card-desc">{a.description}</div>
      <div className="alt-card-job">
        <b>用户为什么用它：</b>
        {a.why_users_use}
      </div>
      {a.sources.length > 0 ? (
        <div className="alt-card-sources">
          {a.sources.slice(0, 3).map((s, i) => (
            <a key={i} href={s} target="_blank" rel="noopener noreferrer" className="alt-source-link">
              [source {i + 1}]
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StrategicProfiles({
  alternatives,
  profiles,
}: {
  alternatives: Alternative[];
  profiles: StrategicProfile[];
}) {
  const byId = new Map(alternatives.map((a) => [a.id, a]));
  return (
    <div className="profile-list">
      {profiles.map((p) => {
        const alt = byId.get(p.alt_id);
        if (!alt) return null;
        const moat = MOAT_META[p.moat_strength];
        return (
          <div key={p.alt_id} className="profile-card">
            <div className="profile-head">
              <span className="profile-name">{alt.name}</span>
              <span className={`profile-category ${CATEGORY_META[alt.category].cls}`}>
                {CATEGORY_META[alt.category].label}
              </span>
            </div>
            <div className="profile-grid">
              <div className="profile-field">
                <div className="profile-field-label">承诺 · Promise</div>
                <div className="profile-field-value promise">{p.promise}</div>
              </div>
              <div className="profile-field">
                <div className="profile-field-label">赢利模式 · Revenue</div>
                <div className="profile-field-value">{p.revenue_model}</div>
              </div>
              <div className="profile-field">
                <div className="profile-field-label">
                  护城河 · Moat <span className={`moat-badge ${moat.cls}`}>{moat.label}</span>
                </div>
                <div className="profile-field-value">{p.moat}</div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function FeatureBreakdowns({
  alternatives,
  breakdowns,
}: {
  alternatives: Alternative[];
  breakdowns: FeatureBreakdown[];
}) {
  const byId = new Map(alternatives.map((a) => [a.id, a]));
  return (
    <div className="breakdown-list">
      {breakdowns.map((b) => {
        const alt = byId.get(b.alt_id);
        if (!alt) return null;
        return (
          <div key={b.alt_id} className="breakdown-card">
            <div className="breakdown-head">{alt.name}</div>
            <BreakdownRow label="菜单结构" items={b.menu_structure} />
            <BreakdownRow label="核心流程" items={b.core_flows} />
            <BreakdownRow label="关键交互" items={b.key_interactions} />
            <BreakdownRow label="亮点功能" items={b.headline_features} accent />
          </div>
        );
      })}
    </div>
  );
}

function BreakdownRow({
  label,
  items,
  accent,
}: {
  label: string;
  items: string[];
  accent?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <div className="breakdown-row">
      <div className="breakdown-row-label">{label}</div>
      <div className="breakdown-row-items">
        {items.map((it, i) => (
          <span key={i} className={`breakdown-chip ${accent ? 'accent' : ''}`}>
            {it}
          </span>
        ))}
      </div>
    </div>
  );
}

function ThreatsAndDiff({
  threats,
  hypothesis,
  onPatch,
}: {
  threats: string[];
  hypothesis: string;
  onPatch: (mut: Partial<AlternativesAnalysis>) => void;
}) {
  return (
    <div className="threats-diff">
      <div className="threats-block">
        <div className="threats-label">TOP 威胁</div>
        <EditableList
          items={threats}
          placeholder="一条威胁…"
          addLabel="+ 添加我的威胁"
          onChange={(next) => onPatch({ key_threats: next })}
        />
      </div>
      <div className="diff-block">
        <div className="diff-label">差异化假设 · 一句话说清凭什么赢</div>
        <div className="diff-quote">
          <EditableTextarea
            value={hypothesis}
            placeholder="一句话说清凭什么赢…"
            onChange={(v) => onPatch({ differentiation_hypothesis: v })}
          />
        </div>
        <div className="diff-footnote">
          <em>10 秒读完测试</em>：找 3 个没参与项目的同事念一遍再用自己话复述，
          如果他们说成"就是 XX 的翻版"，假设就失败了。
        </div>
      </div>
    </div>
  );
}
