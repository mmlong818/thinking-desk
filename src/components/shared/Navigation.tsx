'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { getNode, missingDeps, nextNodeKind, type NodeKind } from '@/data/nodes';
import { useProject } from '@/components/project/ProjectStore';
import { useNodeData } from '@/components/project/useNodeData';
import { NodeHat } from './NodeKit';

function lockTip(missing: readonly NodeKind[]): string {
  const names = missing.map((k) => getNode(k)).filter((n) => n).map((n) => `${n?.num} ${n?.label}`);
  return `先采纳 ${names.join('、')} 的条目（完成该节点）才能继续`;
}

/** "继续" to the next node; disabled exactly when that node is still locked by its deps. */
export function ContinueButton({ node, label }: { node: NodeKind; label?: string }) {
  const router = useRouter();
  const { slug } = useProject();
  const { completed } = useNodeData(node);
  const next = nextNodeKind(node);
  const nextDef = next ? getNode(next) : null;
  if (!next || !nextDef) return null;
  const missing = missingDeps(next, completed);
  return (
    <>
      <button
        type="button"
        className="btn btn-accent"
        disabled={missing.length > 0}
        title={missing.length > 0 ? lockTip(missing) : undefined}
        onClick={() => router.push(`/project/${slug}/${next}`)}
      >
        {label ?? `继续 · ${nextDef.num} ${nextDef.label} →`}
      </button>
      {missing.length > 0 ? <span className="dim" style={{ fontSize: 12 }}>{lockTip(missing)}</span> : null}
    </>
  );
}

/** Link to another node of the same project. */
export function NodeLink({ kind, children }: { kind: NodeKind; children: ReactNode }) {
  const { slug } = useProject();
  return (
    <Link href={`/project/${slug}/${kind}`} style={{ color: 'var(--accent)' }}>
      {children}
    </Link>
  );
}

/** Empty state of a node whose upstream context is missing. */
export function MissingUpstream({ kind, chip, title, heading, children }: {
  kind: NodeKind;
  chip: string;
  title: string;
  heading: string;
  children: ReactNode;
}) {
  return (
    <>
      <NodeHat kind={kind} chip={chip} />
      <h1 className="node-title">{title}</h1>
      <div className="empty-state" style={{ marginTop: 40 }}>
        <div className="empty-state-title">{heading}</div>
        {children}
      </div>
    </>
  );
}
