'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Copilot, type CopilotCard } from '@/components/shell/Copilot';
import { EditableText, EditableTextarea, EditableList } from '@/components/shared/Editable';
import { BriefClarifier, type ClarifierAnswer } from '@/components/nodes/BriefClarifier';
import { BriefInterview } from '@/components/nodes/BriefInterview';
import { NodeFollowUpsRunner } from '@/components/shared/NodeFollowUpsRunner';
import type { BriefExtraction } from '@/lib/ai/schemas/extract-brief';
import type { BriefQuestion, ClarifyResult } from '@/lib/ai/schemas/clarify-brief';
import type { ProbeResult, ProbeTurn } from '@/lib/ai/schemas/probe-brief';
import { readCache, writeCache } from '@/lib/client-cache';
import { readPreferredModel } from '@/lib/client-model';
import { nextNodeKind, formatNodeNum } from '@/data/nodes';

type ClarifyAsk = Extract<ClarifyResult, { action: 'ask' }>;
type ProbeQuestion = Extract<ProbeResult, { action: 'question' }>;

interface CachedBrief extends BriefExtraction {
  raw_text?: string;
  answers?: ClarifierAnswer[];
  /** 抽取后副驾驶逐题追问的答案：field → 拼好的答案文本 */
  follow_up_answers?: Record<string, string>;
}

const EXAMPLE = `老板今天扔过来一个新项目。要给 K12 学生做一个 AI 学习陪练的产品，目标是提升学生的自主学习能力。我们大概有一季度的时间。用户是初中生，主要场景是在家做作业时。老板希望做得"像一个真正的陪练"，不是简单的答疑。`;

const FIELD_META: Record<keyof BriefExtraction['fields'], { label: string; sub: string }> = {
  problem_statement: { label: '问题陈述', sub: '核心要解决的问题' },
  target_user:       { label: '目标用户', sub: 'Who' },
  scenario:          { label: '使用场景', sub: 'When / Where' },
  value_prop:        { label: '核心价值主张', sub: '区别于"简单答疑"' },
  success_criteria:  { label: '成功标准', sub: '怎么算赢' },
  time_constraint:   { label: '时间约束', sub: 'Deadline' },
  boundaries:        { label: '明确边界', sub: '本次不做' },
  red_lines:         { label: '道德红线', sub: '无论诱惑多大都不做' },
};

type Stage =
  | { kind: 'paste' }
  | { kind: 'clarifying' } // calling clarify API
  /** v2 新增：AI 建议好澄清模式，用户做最终选择 */
  | { kind: 'mode_choose'; ask: ClarifyAsk }
  | { kind: 'ask'; questions: BriefQuestion[]; reasoning: string; needType: string }
  /** v2 新增：对话式追问流程 */
  | {
      kind: 'interview';
      reasoning: string;
      history: ProbeTurn[];
      current: ProbeQuestion | null;
      probing: boolean;
    }
  | { kind: 'extracting' }
  | {
      kind: 'done';
      extraction: BriefExtraction;
      answers: ClarifierAnswer[];
    };

interface Props {
  projectSlug: string;
  initial?: BriefExtraction & { raw_text?: string; answers?: ClarifierAnswer[] };
}

// Back-fill fields that didn't exist in older extraction payloads so the UI
// doesn't crash reading `.length` on undefined.
function normalizeFields(f: BriefExtraction['fields'] | Record<string, unknown>): BriefExtraction['fields'] {
  return {
    problem_statement: (f as BriefExtraction['fields']).problem_statement ?? null,
    target_user: (f as BriefExtraction['fields']).target_user ?? null,
    scenario: (f as BriefExtraction['fields']).scenario ?? null,
    value_prop: (f as BriefExtraction['fields']).value_prop ?? null,
    success_criteria: (f as BriefExtraction['fields']).success_criteria ?? null,
    time_constraint: (f as BriefExtraction['fields']).time_constraint ?? null,
    boundaries: (f as BriefExtraction['fields']).boundaries ?? [],
    red_lines: (f as BriefExtraction['fields']).red_lines ?? [],
  };
}

function normalizeExtraction(e: Partial<BriefExtraction>): BriefExtraction {
  return {
    highlights: e.highlights ?? [],
    fields: normalizeFields(e.fields ?? {}),
    follow_ups: e.follow_ups ?? [],
    completeness: e.completeness ?? 0,
  };
}

export function BriefNode({ projectSlug, initial }: Props) {
  const router = useRouter();
  const [rawText, setRawText] = useState<string>(initial?.raw_text ?? '');
  const [stage, setStage] = useState<Stage>(
    initial
      ? {
          kind: 'done',
          extraction: normalizeExtraction(initial),
          answers: initial.answers ?? [],
        }
      : { kind: 'paste' },
  );
  const [error, setError] = useState<string | null>(null);
  const [_pending, startTransition] = useTransition();
  const [followUpAnswers, setFollowUpAnswers] = useState<Record<string, string>>(
    (initial as CachedBrief | undefined)?.follow_up_answers ?? {},
  );
  // 一次性导入警告（从 ImportButton 留下的 sessionStorage 里读，显示后清掉）
  const [importWarn, setImportWarn] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const key = `td:import-warn:${decodeURIComponent(projectSlug)}`;
      const v = sessionStorage.getItem(key);
      if (v) {
        setImportWarn(v);
        sessionStorage.removeItem(key);
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  // 把单条 follow-up 答案落进 extraction.fields，并持久化到 cache
  const applyFollowUpAnswer = (field: string, answer: string) => {
    setFollowUpAnswers((prev) => {
      const next = { ...prev, [field]: answer };
      setStage((s) => {
        if (s.kind !== 'done') return s;
        const fields = { ...s.extraction.fields } as BriefExtraction['fields'];
        // 数组字段：append；字符串字段：null → 写入，已有 → 用 ; 接
        if (field === 'boundaries' || field === 'red_lines') {
          const arr = (fields[field] as string[]) ?? [];
          fields[field] = answer === '〔跳过〕'
            ? arr
            : Array.from(new Set([...arr, ...answer.split('；').map((x) => x.trim()).filter(Boolean)]));
        } else if (field in fields) {
          const key = field as Exclude<keyof BriefExtraction['fields'], 'boundaries' | 'red_lines'>;
          const cur = fields[key];
          if (answer === '〔跳过〕') {
            // 不改 fields，只标记答过
          } else if (cur && cur.trim()) {
            fields[key] = `${cur}；${answer}`;
          } else {
            fields[key] = answer;
          }
        }
        const nextExtraction: BriefExtraction = { ...s.extraction, fields };
        // 刷新 cache（带 follow_up_answers）
        const cached: CachedBrief = {
          ...nextExtraction,
          raw_text: rawText,
          answers: s.answers,
          follow_up_answers: next,
        };
        writeCache(projectSlug, 'brief', cached);
        return { ...s, extraction: nextExtraction };
      });
      return next;
    });
  };

  // If the server didn't hydrate anything (DB off) but we have a prior result
  // in sessionStorage, restore it so navigation back to Brief doesn't look
  // like starting over.
  useEffect(() => {
    if (initial) return;
    if (stage.kind !== 'paste') return;
    if (rawText.trim()) return;
    const cached = readCache<CachedBrief>(projectSlug, 'brief');
    if (!cached) return;
    setRawText(cached.raw_text ?? '');
    // 只有当 cache 里有真实抽取结果时才进 'done' —— 否则保持 paste 阶段，
    // 让用户继续编辑 raw_text 草稿（fork 后的常见情形）。
    const hasExtraction = Array.isArray(cached.highlights) && cached.highlights.length > 0;
    if (hasExtraction) {
      setStage({
        kind: 'done',
        extraction: normalizeExtraction(cached),
        answers: cached.answers ?? [],
      });
      // Re-write so the new cookie marker (markDone) is set on first load
      // for projects whose Brief was completed before the cookie mechanism existed.
      writeCache(projectSlug, 'brief', cached);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectSlug]);

  // 草稿即时存：paste 阶段每次 rawText 变化时把 raw_text 落到 cache，
  // 这样切换节点 / 分支项目 / 刷新页面都不丢草稿。
  // 不写空：fork 进来时 rawText='' 会触发本 effect，不能把复制过来的草稿覆盖掉。
  useEffect(() => {
    if (stage.kind !== 'paste') return;
    if (typeof window === 'undefined') return;
    if (rawText.trim() === '') return;
    const handle = setTimeout(() => {
      const existing = readCache<CachedBrief>(projectSlug, 'brief');
      if (existing && Array.isArray(existing.highlights) && existing.highlights.length > 0) {
        // 已有完整抽取结果 — 不要被草稿覆盖
        return;
      }
      writeCache(projectSlug, 'brief', { raw_text: rawText, answers: [] });
    }, 400);
    return () => clearTimeout(handle);
  }, [rawText, stage.kind, projectSlug]);

  // ---- network helpers ----
  async function callClarify(text: string): Promise<ClarifyResult> {
    const res = await fetch('/api/ai/clarify-brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: text, model: readPreferredModel() ?? undefined }),
    });
    const json = (await res.json()) as { ok?: boolean; data?: ClarifyResult; error?: string; detail?: string };
    if (!res.ok || !json.ok || !json.data) {
      throw new Error(json.detail ?? json.error ?? '澄清请求失败');
    }
    return json.data;
  }

  async function callExtract(text: string, answers: ClarifierAnswer[]): Promise<BriefExtraction> {
    const res = await fetch('/api/ai/extract-brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectSlug, rawText: text, answers, model: readPreferredModel() ?? undefined }),
    });
    const json = (await res.json()) as { ok?: boolean; data?: BriefExtraction; error?: string; detail?: string };
    if (!res.ok || !json.ok || !json.data) {
      throw new Error(json.detail ?? json.error ?? '抽取请求失败');
    }
    return json.data;
  }

  // ---- network helpers (added) ----
  async function callProbe(text: string, history: ProbeTurn[]): Promise<ProbeResult> {
    const res = await fetch('/api/ai/probe-brief', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rawText: text, history, model: readPreferredModel() ?? undefined }),
    });
    const json = (await res.json()) as { ok?: boolean; data?: ProbeResult; error?: string; detail?: string };
    if (!res.ok || !json.ok || !json.data) {
      throw new Error(json.detail ?? json.error ?? '追问请求失败');
    }
    return json.data;
  }

  // ---- actions ----
  const startClarify = () => {
    if (!rawText.trim()) return;
    setError(null);
    setStage({ kind: 'clarifying' });
    startTransition(async () => {
      try {
        const clar = await callClarify(rawText);
        if (clar.action === 'proceed') {
          setStage({ kind: 'extracting' });
          const extraction = await callExtract(rawText, []);
          const ex = normalizeExtraction(extraction);
          writeCache(projectSlug, 'brief', { raw_text: rawText, answers: [], ...ex });
          setStage({ kind: 'done', extraction: ex, answers: [] });
        } else {
          // Both modes available — show the chooser and let the user pick.
          setStage({ kind: 'mode_choose', ask: clar });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'paste' });
      }
    });
  };

  const pickMode = (mode: 'questionnaire' | 'interview') => {
    if (stage.kind !== 'mode_choose') return;
    const { ask } = stage;
    if (mode === 'questionnaire') {
      setStage({
        kind: 'ask',
        questions: ask.questions,
        reasoning: ask.reasoning,
        needType: ask.need_type,
      });
      return;
    }
    // interview: fetch first question
    setStage({
      kind: 'interview',
      reasoning: ask.reasoning,
      history: [],
      current: null,
      probing: true,
    });
    startTransition(async () => {
      try {
        const result = await callProbe(rawText, []);
        if (result.action === 'done') {
          // Rare — nothing to ask, skip straight to extract.
          setStage({ kind: 'extracting' });
          const extraction = await callExtract(rawText, []);
          writeCache(projectSlug, 'brief', { raw_text: rawText, answers: [], ...extraction });
          setStage({ kind: 'done', extraction, answers: [] });
          return;
        }
        setStage({
          kind: 'interview',
          reasoning: ask.reasoning,
          history: [],
          current: result,
          probing: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'paste' });
      }
    });
  };

  const answerInterview = (answer: string) => {
    if (stage.kind !== 'interview' || !stage.current) return;
    const newTurn: ProbeTurn = {
      question: stage.current.question,
      answer,
      field_tag: stage.current.field_tag,
    };
    const nextHistory = [...stage.history, newTurn];
    const reasoning = stage.reasoning;
    setStage({ kind: 'interview', reasoning, history: nextHistory, current: null, probing: true });
    startTransition(async () => {
      try {
        const result = await callProbe(rawText, nextHistory);
        if (result.action === 'done') {
          finishInterview(nextHistory);
          return;
        }
        setStage({
          kind: 'interview',
          reasoning,
          history: nextHistory,
          current: result,
          probing: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'interview', reasoning, history: nextHistory, current: null, probing: false });
      }
    });
  };

  const skipInterviewCurrent = () => {
    if (stage.kind !== 'interview' || !stage.current) return;
    const skippedTurn: ProbeTurn = {
      question: stage.current.question,
      answer: '（跳过）',
      field_tag: stage.current.field_tag,
    };
    const nextHistory = [...stage.history, skippedTurn];
    const reasoning = stage.reasoning;
    setStage({ kind: 'interview', reasoning, history: nextHistory, current: null, probing: true });
    startTransition(async () => {
      try {
        const result = await callProbe(rawText, nextHistory);
        if (result.action === 'done') {
          finishInterview(nextHistory);
          return;
        }
        setStage({
          kind: 'interview',
          reasoning,
          history: nextHistory,
          current: result,
          probing: false,
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'interview', reasoning, history: nextHistory, current: null, probing: false });
      }
    });
  };

  const finishInterview = (history?: ProbeTurn[]) => {
    if (stage.kind !== 'interview') return;
    const finalHistory = history ?? stage.history;
    if (finalHistory.length === 0) return;
    setError(null);
    setStage({ kind: 'extracting' });
    startTransition(async () => {
      try {
        // Turn interview history into ClarifierAnswer shape so extract-brief
        // can inject it as "user-confirmed facts".
        const answers: ClarifierAnswer[] = finalHistory
          .filter((t) => t.answer !== '（跳过）')
          .map((t) => ({ question: t.question, answer: t.answer }));
        const extraction = normalizeExtraction(await callExtract(rawText, answers));
        writeCache(projectSlug, 'brief', { raw_text: rawText, answers, ...extraction });
        setStage({ kind: 'done', extraction, answers });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({
          kind: 'interview',
          reasoning: stage.reasoning,
          history: finalHistory,
          current: null,
          probing: false,
        });
      }
    });
  };

  const submitAnswers = (answers: ClarifierAnswer[]) => {
    setError(null);
    setStage({ kind: 'extracting' });
    startTransition(async () => {
      try {
        const extraction = normalizeExtraction(await callExtract(rawText, answers));
        writeCache(projectSlug, 'brief', { raw_text: rawText, answers, ...extraction });
        setStage({ kind: 'done', extraction, answers });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage((s) => (s.kind === 'ask' ? s : { kind: 'paste' }));
      }
    });
  };

  const skipClarifier = () => {
    setError(null);
    setStage({ kind: 'extracting' });
    startTransition(async () => {
      try {
        const extraction = normalizeExtraction(await callExtract(rawText, []));
        writeCache(projectSlug, 'brief', { raw_text: rawText, answers: [], ...extraction });
        setStage({ kind: 'done', extraction, answers: [] });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStage({ kind: 'paste' });
      }
    });
  };

  const reset = () => {
    setStage({ kind: 'paste' });
    setError(null);
  };

  // ---- copilot cards ----
  const cards = useMemo<CopilotCard[]>(() => {
    if (stage.kind === 'paste') {
      return [
        {
          tag: 'feed',
          title: '先把原始文字粘进来',
          body: (
            <>
              我会先<em>判断是否需要澄清</em>：如果需求已经很具体就直接抽取；
              如果还有关键信息没说清楚，我会先生成 7–9 个选择题让你勾一下，
              <em>再基于你的选择做结构化抽取</em>，这样精度会高得多。
            </>
          ),
        },
      ];
    }
    if (stage.kind === 'clarifying') {
      return [
        {
          tag: 'feed',
          title: '正在判断是否需要澄清…',
          body: '我在读你的原始文字，判断清晰度。通常 10–30 秒。',
        },
      ];
    }
    if (stage.kind === 'mode_choose') {
      const mode = stage.ask.suggested_mode;
      return [
        {
          tag: 'ask',
          title: `我建议用「${mode === 'interview' ? '对话式追问' : '静态问卷'}」`,
          body: (
            <>
              {stage.ask.mode_reason || stage.ask.reasoning}
              <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
                不同意？下面两个按钮都可以点，<em>你是司机</em>。
              </div>
            </>
          ),
        },
      ];
    }
    if (stage.kind === 'ask') {
      return [
        {
          tag: 'ask',
          title: '需要先问你几个关键问题',
          body: (
            <>
              {stage.reasoning}
              <div className="dim" style={{ marginTop: 6 }}>
                原则：<em>宁可不问也不问废话</em>，每道题的答案都会显著影响最终 Brief。
              </div>
            </>
          ),
        },
        {
          tag: 'check',
          title: '不想答可以跳过',
          body: '直接点"跳过问卷"就好，我会仅凭原文做最佳努力抽取，但通常完整度会低 15-25 个百分点。',
        },
      ];
    }
    if (stage.kind === 'interview') {
      const n = stage.history.length;
      return [
        {
          tag: 'ask',
          title: n === 0 ? '开始对话式追问' : `已追问 ${n} 轮`,
          body: (
            <>
              {stage.reasoning}
              <div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
                按方法论 §5.3，<em>还原你上一次真实做这件事的过程</em>——
                时间、地点、工具、情绪、替代方案都可能带出关键信息。
              </div>
            </>
          ),
        },
        {
          tag: 'check',
          title: '答够了随时结束',
          body: '下面有"结束追问"按钮，任何时候都可以提前收尾。最多 7 轮我会自动收尾。',
        },
      ];
    }
    if (stage.kind === 'extracting') {
      return [
        {
          tag: 'feed',
          title: '正在做结构化抽取…',
          body: '把你的原文 + 问卷选择交给模型，标注事实/假设/缺失并填充 7 个字段。',
        },
      ];
    }
    const result = stage.extraction;
    const factCount = result.highlights.filter((h) => h.kind === 'fact').length;
    const assumeCount = result.highlights.filter((h) => h.kind === 'assumption').length;
    const missingCount = result.highlights.filter((h) => h.kind === 'missing').length;
    const feedCard: CopilotCard = {
      tag: 'feed',
      title: '抽取完成',
      body: (
        <>
          识别出 <b>{factCount} 个事实</b>、<b>{assumeCount} 个假设</b>、
          <b>{missingCount} 处缺失</b>。
          {stage.answers.length > 0 ? <> 已基于你的 <b>{stage.answers.length}</b> 个问卷选择。</> : null}
        </>
      ),
    };
    if (result.follow_ups.length === 0) {
      return [feedCard];
    }
    // 把所有 follow_ups 包进一张交互卡：runner 内部处理"逐题展示"和多选 + 自由输入
    const runnerCard: CopilotCard = {
      tag: 'ask',
      title: '逐题补齐缺失',
      bare: true,
      body: (
        <NodeFollowUpsRunner
          items={result.follow_ups.map((q) => ({
            field: q.field,
            question: q.question,
            why: q.why,
            options: q.options ?? [],
          }))}
          answers={followUpAnswers}
          onAnswer={applyFollowUpAnswer}
        />
      ),
    };
    return [feedCard, runnerCard];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, followUpAnswers]);

  // ---- center workspace ----
  return (
    <div className="main">
      <main className="work">
        <div className="work-inner">
          <div className="node-hat">
            <span className="node-hat-num">{formatNodeNum('brief')}</span>
            <span className="node-hat-rule" />
            <span className="node-hat-chip">{stageChip(stage)}</span>
          </div>
          <h1 className="node-title">Brief：先把问题说清楚</h1>
          <p className="node-intro">
            先把手上的需求<em>用一两段话描述</em>出来——可以直接复制老板的原话。
            我会先判断是否需要澄清，<em>缺信息就先问你几个选择题</em>，然后再做结构化抽取。
          </p>
          {importWarn ? (
            <div
              role="status"
              style={{
                margin: '12px 0',
                padding: '10px 14px',
                background: 'var(--warn-soft)',
                border: '1px solid var(--warn)',
                color: 'var(--ink-2)',
                borderRadius: 5,
                fontSize: 13,
                lineHeight: 1.6,
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
              }}
            >
              <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--warn)', whiteSpace: 'nowrap', marginTop: 2 }}>导入</span>
              <span style={{ flex: 1 }}>{importWarn}</span>
              <button
                type="button"
                onClick={() => setImportWarn(null)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 16, lineHeight: 1, padding: 0 }}
                aria-label="关闭"
              >
                ×
              </button>
            </div>
          ) : null}

          {/* § 1 paste */}
          <div className="para-section">
            <div className="para-h">

              <span className="para-h-title">原始需求</span>
              <span className="para-h-hint">{stageHint(stage)}</span>
            </div>

            {stage.kind === 'paste' ||
            stage.kind === 'clarifying' ||
            stage.kind === 'mode_choose' ? (
              <div className="paste-area">
                <textarea
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder={`把原始需求文字粘进来……\n\n例如：\n${EXAMPLE}`}
                  disabled={stage.kind === 'clarifying'}
                />
                <div className="paste-foot">
                  <span>{rawText.length} 字 · 支持中英混排 · 可直接粘贴会议纪要</span>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setRawText(EXAMPLE)}
                      disabled={stage.kind === 'clarifying'}
                    >
                      试试示例
                    </button>
                    <button
                      type="button"
                      className="btn btn-accent"
                      onClick={startClarify}
                      disabled={stage.kind === 'clarifying' || !rawText.trim()}
                    >
                      {stage.kind === 'clarifying' ? (
                        <>
                          <span className="ai-spinner" />
                          &nbsp; 判断中
                        </>
                      ) : (
                        '开始分析 →'
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <HighlightedPaste rawText={rawText} extraction={stage.kind === 'done' ? stage.extraction : undefined} />
            )}

            {error ? (
              <div className="cop-card" style={{ marginTop: 14, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                <div className="cop-card-title">调用失败</div>
                <div className="cop-card-body" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{error}</div>
              </div>
            ) : null}
          </div>

          {/* § 2 mode chooser (v2) */}
          {stage.kind === 'mode_choose' ? (
            <div className="para-section">
              <div className="para-h">

                <span className="para-h-title">选择澄清方式</span>
                <span className="para-h-hint">
                  AI 建议：{stage.ask.suggested_mode === 'interview' ? '对话式追问' : '静态问卷'}
                </span>
              </div>
              <ModeChooser
                ask={stage.ask}
                onPick={pickMode}
                onSkip={skipClarifier}
              />
            </div>
          ) : null}

          {/* § 2 questionnaire mode */}
          {stage.kind === 'ask' ? (
            <div className="para-section">
              <div className="para-h">

                <span className="para-h-title">澄清问卷</span>
                <span className="para-h-hint">AI 现场生成 · 按需求定制</span>
              </div>
              <BriefClarifier
                reasoning={stage.reasoning}
                needType={stage.needType}
                questions={stage.questions}
                onSubmit={submitAnswers}
                onSkip={skipClarifier}
                pending={false}
              />
            </div>
          ) : null}

          {/* § 2 interview mode (v2) */}
          {stage.kind === 'interview' ? (
            <div className="para-section">
              <div className="para-h">

                <span className="para-h-title">对话式追问</span>
                <span className="para-h-hint">
                  §5.3 访谈法 · {stage.history.length} 轮已答
                </span>
              </div>
              <BriefInterview
                rawText={rawText}
                history={stage.history}
                current={stage.current}
                pending={stage.probing}
                onAnswer={answerInterview}
                onSkipCurrent={skipInterviewCurrent}
                onFinish={() => finishInterview()}
              />
            </div>
          ) : null}

          {stage.kind === 'extracting' ? (
            <div className="para-section">
              <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
                <span className="ai-spinner" />
                &nbsp; 正在做结构化抽取，通常 20–40 秒……
              </div>
            </div>
          ) : null}

          {/* § 3 extraction result */}
          {stage.kind === 'done' ? (
            <DoneSections
              extraction={stage.extraction}
              answers={stage.answers}
              onReset={reset}
              onPatchFields={(mut) => {
                if (stage.kind !== 'done') return;
                const nextFields = { ...stage.extraction.fields, ...mut };
                const nextExtraction = { ...stage.extraction, fields: nextFields };
                setStage({ ...stage, extraction: nextExtraction });
                writeCache(projectSlug, 'brief', {
                  raw_text: rawText,
                  answers: stage.answers,
                  ...nextExtraction,
                });
              }}
              onContinue={() => {
                const next = nextNodeKind('brief');
                if (next) router.push(`/project/${projectSlug}/${next}`);
              }}
            />
          ) : null}
        </div>
      </main>

      <Copilot
        projectSlug={projectSlug}
        nodeKind="brief"
        cards={stage.kind === 'paste' && rawText.trim() === '' ? [] : cards}
        silent={stage.kind === 'paste' && rawText.trim() === ''}
        pending={
          stage.kind === 'clarifying' ||
          stage.kind === 'extracting' ||
          (stage.kind === 'interview' && stage.probing)
        }
      />
    </div>
  );
}

function stageChip(stage: Stage): string {
  switch (stage.kind) {
    case 'paste':       return 'v0.3 · 双澄清模式';
    case 'clarifying':  return '判断是否需要澄清…';
    case 'mode_choose': return '选择澄清方式';
    case 'ask':         return '澄清问卷 · 请勾选';
    case 'interview':   return '对话式追问中…';
    case 'extracting':  return '结构化抽取中…';
    case 'done':        return '抽取完成 · 可编辑';
  }
}

function stageHint(stage: Stage): string {
  switch (stage.kind) {
    case 'paste':       return '等待粘贴';
    case 'clarifying':  return '判断中…';
    case 'mode_choose': return '已锁定 · 请选模式';
    case 'ask':         return '已锁定 · 问卷中';
    case 'interview':   return '已锁定 · 追问中';
    case 'extracting':  return '抽取中…';
    case 'done':        return '已分析';
  }
}

function ModeChooser({
  ask,
  onPick,
  onSkip,
}: {
  ask: ClarifyAsk;
  onPick: (mode: 'questionnaire' | 'interview') => void;
  onSkip: () => void;
}) {
  const suggested = ask.suggested_mode;
  return (
    <div className="mode-chooser">
      <div className="mode-chooser-reason">
        <b>AI 的判断：</b>
        {ask.mode_reason || ask.reasoning}
      </div>
      <div className="mode-chooser-options">
        <ModeCard
          mode="questionnaire"
          title="静态问卷"
          subtitle="一次抛 7-9 道选择题 · 最快"
          desc={[
            '适合原文信息密度较高',
            '主要缺的是细节（deadline / 预算 / 付费方）',
            '几分钟就能答完',
          ]}
          suggested={suggested === 'questionnaire'}
          count={ask.questions.length}
          onPick={() => onPick('questionnaire')}
        />
        <ModeCard
          mode="interview"
          title="对话式追问"
          subtitle="一问一答 · 按 §5.3 访谈法"
          desc={[
            '适合原文很短或很模糊',
            '还原你"上一次真实做这件事"的过程',
            '高风险领域（K12 / 医疗 / 金融）推荐',
          ]}
          suggested={suggested === 'interview'}
          count={null}
          onPick={() => onPick('interview')}
        />
      </div>
      <div className="mode-chooser-skip">
        <button type="button" className="btn btn-ghost" onClick={onSkip}>
          都不要 · 直接用原文抽取
        </button>
        <span className="dim" style={{ fontSize: 11 }}>
          精度通常会低 15-25 个百分点
        </span>
      </div>
    </div>
  );
}

function ModeCard({
  title,
  subtitle,
  desc,
  suggested,
  count,
  onPick,
}: {
  mode: 'questionnaire' | 'interview';
  title: string;
  subtitle: string;
  desc: string[];
  suggested: boolean;
  count: number | null;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className={`mode-card ${suggested ? 'suggested' : ''}`}
      onClick={onPick}
    >
      {suggested ? <span className="mode-card-badge">AI 推荐</span> : null}
      <div className="mode-card-title">{title}</div>
      <div className="mode-card-subtitle">{subtitle}</div>
      <ul className="mode-card-desc">
        {desc.map((d) => (
          <li key={d}>{d}</li>
        ))}
      </ul>
      <div className="mode-card-foot">
        {count !== null ? `已准备 ${count} 道题` : '第一个问题正在生成'} →
      </div>
    </button>
  );
}

function DoneSections({
  extraction,
  answers,
  onReset,
  onContinue,
  onPatchFields,
}: {
  extraction: BriefExtraction;
  answers: ClarifierAnswer[];
  onReset: () => void;
  onContinue: () => void;
  onPatchFields: (mut: Partial<BriefExtraction['fields']>) => void;
}) {
  return (
    <>
      {answers.length > 0 ? (
        <div className="para-section">
          <div className="para-h">

            <span className="para-h-title">澄清回答</span>
            <span className="para-h-hint">{answers.length} 条 · 已作为事实进入 Brief</span>
          </div>
          <div className="brief-form">
            {answers.map((a, i) => (
              <div className="brief-row" key={i}>
                <div className="brief-label">{a.question}</div>
                <div className="brief-value">
                  <span className="ai-filled">
                    {Array.isArray(a.answer) ? a.answer.join(' · ') : a.answer}
                  </span>
                </div>
                <div className="brief-status filled">✓</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="para-section">
        <div className="para-h">

          <span className="para-h-title">结构化 Brief</span>
          <span className="para-h-hint">AI 已填 · 点任意字段可改</span>
        </div>
        <StructuredFields fields={extraction.fields} onPatch={onPatchFields} />
      </div>

      <div className="para-section">
        <div className="para-h">

          <span className="para-h-title">完整度</span>
          <span className="para-h-hint">70% 以上可进入下一节点</span>
        </div>
        <div className="completeness-bar">
          <span className="completeness-num">
            {extraction.completeness}
            <span style={{ fontSize: 14, color: 'var(--ink-4)' }}>%</span>
          </span>
          <div style={{ flex: 1 }}>
            <div className="bar"><div style={{ width: `${extraction.completeness}%` }} /></div>
            <div className="completeness-note" style={{ marginTop: 8 }}>
              {extraction.completeness >= 70 ? (
                <>
                  <b>已达阈值</b> —— 可以进入下一节点，剩余项可稍后补充。
                </>
              ) : (
                <>
                  <b>还差 {70 - extraction.completeness} 个百分点</b> —— 右侧的追问逐个回答即可。
                </>
              )}
            </div>
          </div>
          <button
            type="button"
            className="btn btn-accent"
            onClick={onContinue}
            disabled={extraction.completeness < 70}
          >
            继续 → 02 用户与任务
          </button>
        </div>
      </div>

      <div className="para-section">
        <div className="para-h">

          <span className="para-h-title">明确不做的事</span>
          <span className="para-h-hint">本次能力边界之外</span>
        </div>
        <EditableList
          items={extraction.fields.boundaries}
          placeholder="一条边界…"
          addLabel="+ 添加我的边界"
          onChange={(next) => onPatchFields({ boundaries: next })}
        />
      </div>

      <div className="para-section">
        <div className="para-h">

          <span className="para-h-title">道德红线</span>
          <span className="para-h-hint">
            方法论 §4.1 硬性要求 · 无论商业诱惑多大都不做
          </span>
        </div>
        {extraction.fields.red_lines.length === 0 ? (
          <div className="red-line-empty" style={{ marginBottom: 10 }}>
            <b>⚠ 尚未定义道德红线。</b>
            建议手动补上 2-3 条——这会在后续每个节点的伦理审查里被反复引用。
            举例：<em>不收集未成年人生物信息 · 不默认开启付费订阅 · 不使用情绪操纵式推送</em>
          </div>
        ) : null}
        <EditableList
          items={extraction.fields.red_lines}
          placeholder="一条红线…"
          addLabel="+ 添加我的红线"
          onChange={(next) => onPatchFields({ red_lines: next })}
        />
      </div>

      <div className="para-section">
        <button type="button" className="btn btn-ghost" onClick={onReset}>
          重新粘贴 / 重新分析
        </button>
      </div>
    </>
  );
}

function HighlightedPaste({ rawText, extraction }: { rawText: string; extraction?: BriefExtraction }) {
  const { factCount, assumeCount, missingCount, parts } = useMemo(() => {
    if (!extraction) {
      return { factCount: 0, assumeCount: 0, missingCount: 0, parts: [{ text: rawText }] };
    }
    const ranges = extraction.highlights
      .map((h) => {
        const idx = rawText.indexOf(h.text);
        return idx >= 0 ? { idx, len: h.text.length, kind: h.kind } : null;
      })
      .filter((r): r is { idx: number; len: number; kind: 'fact' | 'assumption' | 'missing' } => r !== null)
      .sort((a, b) => a.idx - b.idx);

    const parts: { text: string; kind?: 'fact' | 'assumption' | 'missing' }[] = [];
    let cursor = 0;
    for (const r of ranges) {
      if (r.idx < cursor) continue;
      if (r.idx > cursor) parts.push({ text: rawText.slice(cursor, r.idx) });
      parts.push({ text: rawText.slice(r.idx, r.idx + r.len), kind: r.kind });
      cursor = r.idx + r.len;
    }
    if (cursor < rawText.length) parts.push({ text: rawText.slice(cursor) });

    const extraMissing = extraction.highlights.filter(
      (h) => h.kind === 'missing' && rawText.indexOf(h.text) === -1,
    );
    if (extraMissing.length) {
      parts.push({ text: ' ' });
      for (const m of extraMissing) parts.push({ text: m.text, kind: 'missing' });
    }

    return {
      factCount: extraction.highlights.filter((h) => h.kind === 'fact').length,
      assumeCount: extraction.highlights.filter((h) => h.kind === 'assumption').length,
      missingCount: extraction.highlights.filter((h) => h.kind === 'missing').length,
      parts,
    };
  }, [rawText, extraction]);

  return (
    <div className="paste-box">
      <div>
        {parts.map((p, i) =>
          p.kind ? (
            <span key={i} className={`hl hl-${p.kind === 'assumption' ? 'assume' : p.kind}`}>
              {p.text}
            </span>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>
      {extraction ? (
        <div className="hl-legend">
          <span><span className="hl-dot" style={{ background: 'var(--fact-b)' }} />事实</span>
          <span><span className="hl-dot" style={{ background: 'var(--assumption-b)' }} />假设</span>
          <span><span className="hl-dot" style={{ background: 'var(--missing-b)' }} />缺失</span>
          <span className="dim" style={{ marginLeft: 'auto' }}>
            {factCount} 事实 · {assumeCount} 假设 · {missingCount} 缺失
          </span>
        </div>
      ) : null}
    </div>
  );
}

type ScalarFieldKey = 'problem_statement' | 'target_user' | 'scenario' | 'value_prop' | 'success_criteria' | 'time_constraint';
const LONG_FIELDS: ReadonlySet<ScalarFieldKey> = new Set(['problem_statement', 'value_prop', 'scenario', 'success_criteria']);

function StructuredFields({
  fields,
  onPatch,
}: {
  fields: BriefExtraction['fields'];
  onPatch: (mut: Partial<BriefExtraction['fields']>) => void;
}) {
  // boundaries / red_lines 在 § 5 / § 6 单独以 EditableList 渲染，这里跳过避免重复。
  const scalarKeys: ScalarFieldKey[] = ['problem_statement', 'target_user', 'scenario', 'value_prop', 'success_criteria', 'time_constraint'];

  return (
    <div className="brief-form">
      {scalarKeys.map((key) => {
        const meta = FIELD_META[key];
        const v = fields[key];
        const empty = v == null || (typeof v === 'string' && v.trim() === '');
        const isLong = LONG_FIELDS.has(key);
        return (
          <div className="brief-row" key={key}>
            <div className="brief-label">
              {meta.label}
              <small>{meta.sub}</small>
            </div>
            <div className="brief-value">
              {isLong ? (
                <EditableTextarea
                  value={v ?? ''}
                  placeholder="未定义 · 点击补充"
                  onChange={(next) => onPatch({ [key]: next === '' ? null : next } as Partial<BriefExtraction['fields']>)}
                />
              ) : (
                <EditableText
                  value={v ?? ''}
                  placeholder="未定义 · 点击补充"
                  onChange={(next) => onPatch({ [key]: next === '' ? null : next } as Partial<BriefExtraction['fields']>)}
                />
              )}
            </div>
            <div className={`brief-status ${empty ? 'empty' : 'filled'}`}>
              {empty ? '' : '✓'}
            </div>
          </div>
        );
      })}
    </div>
  );
}
