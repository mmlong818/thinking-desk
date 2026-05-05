import Link from 'next/link';
import { getNode, formatNodeNum, type NodeKind } from '@/data/nodes';

interface Props {
  projectSlug: string;
  current: NodeKind;
  missing: readonly NodeKind[];
}

export function LockedNode({ projectSlug, current, missing }: Props) {
  const node = getNode(current);
  const target = missing[0];
  const targetNode = target ? getNode(target) : null;
  const missingLabels = missing
    .map((m) => getNode(m))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => `${n.num} ${n.label}`)
    .join('、');

  return (
    <main className="canvas">
      <div className="locked-stage">
        <div className="locked-card">
          <div className="locked-eyebrow">{formatNodeNum(current)}</div>
          <h1 className="locked-title">
            {node?.label}
            <span className="locked-icon" aria-hidden>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                <rect x="4.5" y="10.5" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="1.6" />
                <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </span>
          </h1>
          <p className="locked-sub">这一节还没解锁。</p>
          <p className="locked-body">
            需要先完成 <b>{missingLabels}</b>，{node?.label} 才有可推理的上下文。
            我不替你跳过 — 跳过的代价是后面每一步都更虚。
          </p>
          {targetNode ? (
            <Link
              href={`/project/${projectSlug}/${targetNode.kind}`}
              className="btn btn-accent locked-cta"
            >
              去 {targetNode.num} {targetNode.label}
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                <path d="M5 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          ) : null}
        </div>
      </div>
    </main>
  );
}
