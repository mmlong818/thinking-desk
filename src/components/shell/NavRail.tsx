'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { NODES, type NodeDef, type NodeKind } from '@/data/nodes';
import type { StoreRef } from '@/lib/store/store-ref';
import { ClientProjectName } from './ClientProjectName';
import { ForkButton } from './ForkButton';

interface Props {
  projectSlug: string;
  projectName: string;
  active: NodeKind;
  completed: readonly NodeKind[];
  /** 上游未完成的节点 — 在导航栏显示为禁用 */
  lockedKinds?: readonly NodeKind[];
  store: StoreRef;
}

// Below 1280 px the rail folds to node numbers (CSS, so the first paint is already right);
// the toggle overrides that per browser. pref: auto = follow the width, open / closed = the person's choice.
type NavPref = 'auto' | 'open' | 'closed';
const PREF_KEY = 'td:nav-pref';

function useNavPref() {
  const [pref, setPref] = useState<NavPref>('auto');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(PREF_KEY);
      if (saved === 'open' || saved === 'closed') setPref(saved);
    } catch {
      // storage unavailable: keep following the width
    }
  }, []);
  const choose = (next: NavPref) => {
    setPref(next);
    try {
      localStorage.setItem(PREF_KEY, next);
    } catch {
      // the choice just won't survive a reload
    }
  };
  return { pref, choose };
}

export function NavRail({ projectSlug, projectName, active, completed, lockedKinds = [], store }: Props) {
  const { pref, choose } = useNavPref();
  const navRef = useRef<HTMLElement>(null);
  const toggle = () => {
    const folded = (navRef.current?.getBoundingClientRect().width ?? 0) < 100;
    choose(folded ? 'open' : 'closed');
  };
  const lockedSet = new Set(lockedKinds);
  const sections = [...new Set(NODES.map((n) => n.section))];
  const completedSet = new Set(completed);
  const doneCount = completed.length;
  const pct = Math.round((doneCount / NODES.length) * 100);

  return (
    <aside className="nav" data-pref={pref} ref={navRef}>
      <button type="button" className="nav-toggle" onClick={toggle} title="收起 / 展开项目地图" aria-label="收起或展开项目地图">
        <span className="nav-toggle-fold">«</span>
        <span className="nav-toggle-unfold">»</span>
      </button>
      <div className="nav-mini-progress" title={`总进度 ${pct}%`}>{doneCount}/{NODES.length}</div>
      <div className="nav-project">
        <div className="nav-project-name"><ClientProjectName slug={projectSlug} fallback={projectName} /></div>
        <div className="nav-project-sub">
          <span>{store.mode === 'pg' ? 'Postgres 项目' : '本地项目 · 存在本浏览器'}</span>
        </div>
        <div className="progress-bar"><div style={{ width: `${pct}%` }} /></div>
        <div className="progress-label">
          <span>总进度 {pct}%</span>
          <span>{doneCount} / {NODES.length} 节点</span>
        </div>
        <div className="nav-project-actions">
          <ForkButton fromName={projectName} currentNode={active} store={store} />
        </div>
      </div>

      <div className="nav-title">项目地图</div>

      {sections.map((sec) => (
        <div key={sec}>
          <div className="nav-section-label">{sec}</div>
          {NODES.filter((n) => n.section === sec).map((n) => (
            <NavNodeRow
              key={n.kind}
              node={n}
              href={`/project/${projectSlug}/${n.kind}`}
              state={n.kind === active ? 'doing' : completedSet.has(n.kind) ? 'done' : lockedSet.has(n.kind) ? 'locked' : 'todo'}
            />
          ))}
        </div>
      ))}
    </aside>
  );
}

type RowState = 'doing' | 'done' | 'locked' | 'todo';

function NavNodeRow({ node: n, href, state }: { node: NodeDef; href: string; state: RowState }) {
  const className = `node-row ${state === 'doing' ? 'active' : ''} ${state === 'locked' ? 'locked' : ''} ${state === 'done' ? 'done' : ''}`;
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
  if (state === 'locked') {
    return <span className={className} aria-disabled="true" title={`${n.num} ${n.label} · 上游节点未完成`}>{inner}</span>;
  }
  return <Link href={href} className={className} title={`${n.num} ${n.label}`}>{inner}</Link>;
}
