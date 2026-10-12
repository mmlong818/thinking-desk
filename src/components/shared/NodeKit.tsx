'use client';

import type { ReactNode } from 'react';
import { formatNodeNum, type NodeKind } from '@/data/nodes';

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

/** Work area + copilot column. */
export function NodeFrame({ wide, copilot, children }: { wide?: boolean; copilot: ReactNode; children: ReactNode }) {
  return (
    <div className="main">
      <main className={wide ? 'work wide' : 'work'}>
        <div className="work-inner">{children}</div>
      </main>
      {copilot}
    </div>
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
