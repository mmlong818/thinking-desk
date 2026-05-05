'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { readPreferredModel } from '@/lib/client-model';

export interface CopilotCard {
  tag: 'feed' | 'ask' | 'check' | 'critique';
  title: string;
  body: ReactNode;
  actions?: { label: string; kind?: 'accept' | 'reject'; onClick?: () => void }[];
  /** true 时跳过 cop-card 外壳，直接渲染 body —— 让 body 自带容器（如 BriefFollowUpsRunner）。 */
  bare?: boolean;
}

interface Props {
  cards: CopilotCard[];
  pending?: boolean;
  /** 静默模式：用户尚未开始输入时，不显示初始引导文案，只显示呼吸态占位 */
  silent?: boolean;
  /** 启用自由问答 composer：传入则 textarea 受控并接通 /api/ai/free-ask */
  projectSlug?: string;
  nodeKind?: string;
  /** 在 cards 之后、composer 之前渲染的额外内容（如逐题追问 runner）。 */
  extraSlot?: ReactNode;
}

const TAG_LABEL: Record<CopilotCard['tag'], string> = {
  feed: '进料 · FEED',
  ask: '追问 · ASK',
  check: '提醒 · CHECK',
  critique: '挑战 · CRITIQUE',
};

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

export function Copilot({ cards, pending, silent, projectSlug, nodeKind, extraSlot }: Props) {
  const composerEnabled = Boolean(projectSlug && nodeKind);
  const [draft, setDraft] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const [askErr, setAskErr] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const isSilent = silent && cards.length === 0 && turns.length === 0 && !pending && !asking;

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [turns.length, asking, cards.length]);

  const send = async () => {
    if (!composerEnabled || asking) return;
    const q = draft.trim();
    if (!q) return;
    setAskErr(null);
    setAsking(true);
    const history = turns.slice(-12);
    setTurns((prev) => [...prev, { role: 'user', content: q }]);
    setDraft('');
    try {
      const preferred = readPreferredModel();
      const res = await fetch('/api/ai/free-ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectSlug,
          nodeKind,
          question: q,
          history,
          ...(preferred ? { model: preferred } : {}),
        }),
      });
      const json = (await res.json()) as { ok?: boolean; data?: { text: string }; error?: string; detail?: string };
      if (!res.ok || !json.ok || !json.data) {
        throw new Error(json.detail ?? json.error ?? '回答失败');
      }
      setTurns((prev) => [...prev, { role: 'assistant', content: json.data!.text }]);
    } catch (e) {
      setAskErr(e instanceof Error ? e.message : String(e));
    } finally {
      setAsking(false);
      taRef.current?.focus();
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <aside className="copilot">
      <div className="copilot-head">
        <div className="copilot-avatar">副</div>
        <div>
          <div className="copilot-head-name">AI 副驾驶</div>
          <div className="copilot-head-sub">基于当前节点 · 已读上下文</div>
        </div>
        <div className="copilot-status">
          <span className={`dot ${isSilent ? 'breathing' : ''}`} />
          {isSilent ? '待命' : asking || pending ? '思考中' : '在场'}
        </div>
      </div>

      <div className="copilot-scroll" ref={scrollRef}>
        {isSilent ? (
          <div className="copilot-silent" aria-hidden>
            <span className="copilot-silent-pulse" />
          </div>
        ) : (
          <>
            {pending && cards.length === 0 && turns.length === 0 ? (
              <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-4)' }}>
                <span className="ai-spinner" /> &nbsp; 正在分析你的输入……
              </div>
            ) : cards.length === 0 && turns.length === 0 ? (
              <div className="cop-card" style={{ color: 'var(--ink-4)' }}>
                <div className="cop-card-title">还没有反馈</div>
                <div className="cop-card-body">在左侧粘贴或输入内容后，我会主动推进来。</div>
              </div>
            ) : null}

            {cards.map((card, i) =>
              card.bare ? (
                <div key={`c${i}`}>{card.body}</div>
              ) : (
                <div className="cop-card" key={`c${i}`}>
                  <div className={`cop-card-tag ${card.tag}`}>{TAG_LABEL[card.tag]}</div>
                  <div className="cop-card-title">{card.title}</div>
                  <div className="cop-card-body">{card.body}</div>
                  {card.actions && card.actions.length > 0 ? (
                    <div className="cop-actions">
                      {card.actions.map((a, j) => (
                        <button
                          key={j}
                          type="button"
                          className={`cop-action-btn ${a.kind ?? ''}`}
                          onClick={a.onClick}
                        >
                          {a.kind === 'accept' ? '✓ ' : ''}{a.label}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ),
            )}

            {extraSlot}

            {turns.map((t, i) => (
              <div className={`cop-turn cop-turn-${t.role}`} key={`t${i}`}>
                <div className="cop-turn-tag">{t.role === 'user' ? '你' : '副驾驶'}</div>
                <div className="cop-turn-body">{t.content}</div>
              </div>
            ))}

            {asking ? (
              <div className="cop-turn cop-turn-assistant">
                <div className="cop-turn-tag">副驾驶</div>
                <div className="cop-turn-body" style={{ color: 'var(--ink-4)' }}>
                  <span className="ai-spinner" /> 思考中…
                </div>
              </div>
            ) : null}

            {askErr ? (
              <div className="cop-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
                <div className="cop-card-title">问答失败</div>
                <div className="cop-card-body" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{askErr}</div>
              </div>
            ) : null}
          </>
        )}
      </div>

      <div className="cop-composer">
        <div className="cop-composer-principle">— 追问优于回答 · 不替你做决定 —</div>
        <div className="cop-composer-box">
          <textarea
            ref={taRef}
            className="cop-composer-input"
            rows={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              composerEnabled
                ? '回复、补充，或让我换个角度问 …（Enter 发送 · Shift+Enter 换行）'
                : '副驾驶尚未接通到本节点'
            }
            disabled={!composerEnabled || asking}
          />
          <button
            type="button"
            className="cop-send"
            aria-label="发送"
            onClick={send}
            disabled={!composerEnabled || asking || draft.trim() === ''}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10m0 0L9 4m4 4l-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </div>
    </aside>
  );
}
