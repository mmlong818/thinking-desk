'use client';

import type { ReactNode } from 'react';
import { formatNodeNum, type NodeKind } from '@/data/nodes';
import type { Item } from '@/lib/model/item-types';
import { RedoProvider, type RedoHandler } from './RedoContext';

// Small building blocks every node page shares.

/** "NODE · 02 / 09 ——— <stage chip>" */
export function NodeHat({ kind, chip }: { kind: NodeKind; chip: string }) {
  return (
    <div className="node-hat">
      <span className="node-hat-num">{formatNodeNum(kind)}</span>
      <span className="node-hat-rule" />
      <span className="node-hat-chip">{chip}</span>
    </div>
  );
}

/**
 * Work area + copilot column. `redo` = the node's regenerate actions, offered on stale items
 * ("让 AI 按新内容重做").
 */
export function NodeFrame({ wide, copilot, redo, children }: {
  wide?: boolean;
  copilot: ReactNode;
  redo?: readonly RedoHandler[];
  children: ReactNode;
}) {
  return (
    <RedoProvider handlers={redo}>
      <div className="main">
        <main className={wide ? 'work wide' : 'work'}>
          <div className="work-inner">{children}</div>
        </main>
        {copilot}
      </div>
    </RedoProvider>
  );
}

export function ErrorCard({ title = '调用失败', message, mono = true }: { title?: string; message: string | null; mono?: boolean }) {
  if (!message) return null;
  return (
    <div className="cop-card" style={{ marginTop: 14, borderColor: 'var(--danger)', color: 'var(--danger)' }}>
      <div className="cop-card-title">{title}</div>
      <div className="cop-card-body" style={mono ? { fontFamily: 'var(--mono)', fontSize: 12 } : { fontSize: 12 }}>
        {message}
      </div>
    </div>
  );
}

export function LoadingCard({ children }: { children: ReactNode }) {
  return (
    <div className="para-section">
      <div className="cop-card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
        <span className="ai-spinner" />
        &nbsp; {children}
      </div>
    </div>
  );
}

/** The project is being read (or could not be read). */
export function StoreStatus({ data }: { data: { loading: boolean; loadError: string | null } }) {
  if (data.loadError) return <ErrorCard title="读取项目数据失败" message={data.loadError} />;
  return data.loading ? <LoadingCard>正在读取项目数据…</LoadingCard> : null;
}

/** Section heading used throughout the nodes. */
export function ParaHead({ title, hint, num }: { title: string; hint?: ReactNode; num?: string }) {
  return (
    <div className="para-h">
      {num ? <span className="para-h-num">{num}</span> : null}
      <span className="para-h-title">{title}</span>
      {hint ? <span className="para-h-hint">{hint}</span> : null}
    </div>
  );
}

/** The single primary call to action of an empty node. */
export function CenteredAction({ label, onClick, disabled }: { label: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <div className="para-section" style={{ display: 'flex', justifyContent: 'center' }}>
      <button type="button" className="btn btn-accent" onClick={onClick} disabled={disabled}>
        {label}
      </button>
    </div>
  );
}

/**
 * Re-running a task rewrites its singleton (brief, engagement plan, differentiation hypothesis)
 * in place. When the person already judged or edited it, ask first; the old body stays in the
 * item's history (DecisionEvent.prevBody).
 */
export function confirmSingletonOverwrite(item: Item | undefined, label: string): boolean {
  if (!item || (item.decision === 'pending' && item.origin === 'ai')) return true;
  return window.confirm(`重新生成会改写你已裁决或修改过的「${label}」（旧内容保留在历史记录里），改写后需要重新采纳。继续？`);
}
