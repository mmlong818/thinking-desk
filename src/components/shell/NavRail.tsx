import Link from 'next/link';
import { NODES, type NodeKind } from '@/data/nodes';
import { ClientProjectName } from './ClientProjectName';
import { ForkButton } from './ForkButton';

interface Props {
  projectSlug: string;
  projectName: string;
  active: NodeKind;
  completed: readonly NodeKind[];
  /** 上游未完成的节点 — 在导航栏显示为禁用 */
  lockedKinds?: readonly NodeKind[];
}

export function NavRail({ projectSlug, projectName, active, completed, lockedKinds = [] }: Props) {
  const lockedSet = new Set(lockedKinds);
  const sections = [...new Set(NODES.map((n) => n.section))];
  const activeIdx = NODES.findIndex((n) => n.kind === active);
  const completedSet = new Set(completed);
  const doneCount = completed.length;
  const pct = Math.round((doneCount / NODES.length) * 100);

  return (
    <aside className="nav">
      <div className="nav-project">
        <div className="nav-project-name"><ClientProjectName slug={projectSlug} fallback={projectName} /></div>
        <div className="nav-project-sub">
          <span>本地演示项目</span>
        </div>
        <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
        <div className="progress-label">
          <span>总进度 {pct}%</span>
          <span>{doneCount} / {NODES.length} 节点</span>
        </div>
        <div className="nav-project-actions">
          <ForkButton fromSlug={projectSlug} fromName={projectName} currentNode={active} />
        </div>
      </div>

      <div className="nav-title">项目地图</div>

      {sections.map((sec) => (
        <div key={sec}>
          <div className="nav-section-label">{sec}</div>
          {NODES.filter((n) => n.section === sec).map((n) => {
            const isActive = n.kind === active;
            const isDone = !isActive && completedSet.has(n.kind);
            const isLocked = !isActive && lockedSet.has(n.kind);
            const state = isActive ? 'doing' : isDone ? 'done' : isLocked ? 'locked' : 'todo';
            const className = `node-row ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}`;
            const inner = (
              <>
                <div className="node-num">{n.num}</div>
                <div className="node-label">
                  {n.label}
                  {n.sub ? <small>{n.sub}</small> : null}
                </div>
                <div className={`node-state ${state}`}>
                  {state === 'done' ? '✓' : state === 'locked' ? (
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <rect x="4.5" y="10.5" width="15" height="10" rx="2" stroke="currentColor" strokeWidth="2" />
                      <path d="M8 10V7a4 4 0 1 1 8 0v3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  ) : ''}
                </div>
              </>
            );
            return isLocked ? (
              <span
                key={n.kind}
                className={className}
                aria-disabled="true"
                title="上游节点未完成"
              >
                {inner}
              </span>
            ) : (
              <Link
                key={n.kind}
                href={`/project/${projectSlug}/${n.kind}`}
                className={className}
              >
                {inner}
              </Link>
            );
          })}
        </div>
      ))}
    </aside>
  );
}
