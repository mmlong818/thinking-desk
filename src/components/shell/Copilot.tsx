'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { getNode } from '@/data/nodes';
import { useProject } from '@/components/project/ProjectStore';
import { useAiAction } from '@/components/project/useAiAction';
import { copilotContext } from '@/lib/model/copilot-context';

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

/** Free-form questions: answered with the project's kept items as context; each answer is a recorded run. */
function useFreeAsk(projectSlug: string | undefined, nodeKind: string | undefined) {
  const { snapshot } = useProject();
  const ai = useAiAction();
  const [turns, setTurns] = useState<Turn[]>([]);
  const node = nodeKind ? getNode(nodeKind)?.kind : undefined;
  const send = async (question: string) => {
    if (!node || !projectSlug) return;
    const history = turns.slice(-12);
    setTurns((prev) => [...prev, { role: 'user', content: question }]);
    const out = await ai.run<{ text: string }>('ask', {
      route: '/api/ai/free-ask',
      body: { projectSlug, nodeKind: node, question, history, context: copilotContext(snapshot?.items ?? [], node) },
      node,
      inputs: [],
    });
    if (out.ok) setTurns((prev) => [...prev, { role: 'assistant', content: out.data.text }]);
  };
  return { enabled: Boolean(projectSlug && node), turns, asking: ai.running !== null, error: ai.error, send };
}

export function Copilot({ cards, pending, silent, projectSlug, nodeKind, extraSlot }: Props) {
  const ask = useFreeAsk(projectSlug, nodeKind);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isSilent = silent && cards.length === 0 && ask.turns.length === 0 && !pending && !ask.asking;

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [ask.turns.length, ask.asking, cards.length]);

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
          {isSilent ? '待命' : ask.asking || pending ? '思考中' : '在场'}
        </div>
      </div>
      <div className="copilot-scroll" ref={scrollRef}>
        {isSilent ? (
          <div className="copilot-silent" aria-hidden><span className="copilot-silent-pulse" /></div>
        ) : (
          <CopilotFeed cards={cards} pending={pending} extraSlot={extraSlot} turns={ask.turns} asking={ask.asking} error={ask.error} />
        )}
      </div>
      <Composer enabled={ask.enabled} busy={ask.asking} onSend={(q) => void ask.send(q)} />
    </aside>
  );
}

function CopilotFeed({ cards, pending, extraSlot, turns, asking, error }: {
  cards: CopilotCard[];
  pending?: boolean;
  extraSlot?: ReactNode;
  turns: Turn[];
  asking: boolean;
  error: string | null;
}) {
  return (
    <>
      {pending && cards.length === 0 && turns.length === 0 ? (
        <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-4)' }}><span className="ai-spinner" /> &nbsp; 正在分析你的输入……</div>
      ) : cards.length === 0 && turns.length === 0 ? (
        <div className="cop-card" style={{ color: 'var(--ink-4)' }}>
          <div className="cop-card-title">还没有反馈</div>
          <div className="cop-card-body">在左侧粘贴或输入内容后，我会主动推进来。</div>
        </div>
      ) : null}
      {cards.map((card, i) => (card.bare ? <div key={`c${i}`}>{card.body}</div> : <CardView key={`c${i}`} card={card} />))}
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
          <div className="cop-turn-body" style={{ color: 'var(--ink-4)' }}><span className="ai-spinner" /> 思考中…</div>
        </div>
      ) : null}
      {error ? (
        <div className="cop-card" style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          <div className="cop-card-title">问答失败</div>
          <div className="cop-card-body" style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{error}</div>
        </div>
      ) : null}
    </>
  );
}

function CardView({ card }: { card: CopilotCard }) {
  return (
    <div className="cop-card">
      <div className={`cop-card-tag ${card.tag}`}>{TAG_LABEL[card.tag]}</div>
      <div className="cop-card-title">{card.title}</div>
      <div className="cop-card-body">{card.body}</div>
      {card.actions && card.actions.length > 0 ? (
        <div className="cop-actions">
          {card.actions.map((a, j) => (
            <button key={j} type="button" className={`cop-action-btn ${a.kind ?? ''}`} onClick={a.onClick}>
              {a.kind === 'accept' ? '✓ ' : ''}{a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Composer({ enabled, busy, onSend }: { enabled: boolean; busy: boolean; onSend: (q: string) => void }) {
  const [draft, setDraft] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const send = () => {
    const q = draft.trim();
    if (!enabled || busy || !q) return;
    setDraft('');
    onSend(q);
    taRef.current?.focus();
  };
  return (
    <div className="cop-composer">
      <div className="cop-composer-principle">— 追问优于回答 · 不替你做决定 —</div>
      <div className="cop-composer-box">
        <textarea
          ref={taRef}
          className="cop-composer-input"
          rows={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={enabled ? '回复、补充，或让我换个角度问 …（Enter 发送 · Shift+Enter 换行）' : '副驾驶尚未接通到本节点'}
          disabled={!enabled || busy}
        />
        <button type="button" className="cop-send" aria-label="发送" onClick={send} disabled={!enabled || busy || draft.trim() === ''}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
            <path d="M3 8h10m0 0L9 4m4 4l-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
    </div>
  );
}
