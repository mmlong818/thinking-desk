import Link from 'next/link';
import { getNode, nextNodeKind, type NodeKind } from '@/data/nodes';
import type { StoreRef } from '@/lib/store/store-ref';
import { ModelPicker } from './ModelPicker';
import { ClientProjectName } from './ClientProjectName';
import { ExportButton } from './ExportButton';

interface Props {
  projectName: string;
  projectSlug: string;
  nodeKind: NodeKind;
  /** 当前节点是否锁定（上游未完成） */
  currentLocked?: boolean;
  /** 当前节点缺失的上游 deps */
  currentMissing?: readonly NodeKind[];
  /** 下一节点缺失的上游 deps；非空表示下一节点未解锁 */
  nextLockedReason?: readonly NodeKind[] | null;
  store: StoreRef;
}

export function TopBar({ projectName, projectSlug, nodeKind, currentLocked, currentMissing, nextLockedReason, store }: Props) {
  const node = getNode(nodeKind);
  return (
    <div className="topbar">
      <Link href="/" className="brand">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="2.5" y="2.5" width="19" height="19" rx="2" stroke="#1A1A1A" strokeWidth="1.5" />
          <path d="M7 8h10M7 12h7M7 16h5" stroke="#B84A2B" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="18" cy="16" r="2" fill="#B84A2B" />
        </svg>
        <span className="brand-name">思考工作台</span>
      </Link>
      <div className="sep-v" />
      <div className="crumbs">
        <span>我的项目</span>
        <span>›</span>
        <b><ClientProjectName slug={projectSlug} fallback={projectName} /></b>
        <span>›</span>
        <b style={{ color: 'var(--accent)' }}>{node?.num} {node?.label}</b>
      </div>
      <span className="meta-chip">内部工具 · v0.1</span>
      <div className="spacer" />
      <div className="top-actions">
        <ModelPicker />
        <div className="sep-v" style={{ margin: '0 4px' }} />
        <ExportButton projectSlug={projectSlug} projectName={projectName} store={store} />
        <div style={{ width: 8 }} />
        <NextButton
          projectSlug={projectSlug} nodeKind={nodeKind} currentLocked={currentLocked}
          currentMissing={currentMissing} nextLockedReason={nextLockedReason}
        />
      </div>
    </div>
  );
}

const nodeNames = (kinds: readonly NodeKind[]) =>
  kinds
    .map((k) => getNode(k))
    .filter((n): n is NonNullable<typeof n> => Boolean(n))
    .map((n) => `${n.num} ${n.label}`)
    .join('、');

const Chevron = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
    <path d="M5 3l5 5-5 5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

function NextButton({ projectSlug, nodeKind, currentLocked, currentMissing, nextLockedReason }: Omit<Props, 'projectName' | 'store'>) {
  const nextKind = nextNodeKind(nodeKind);
  const nextNode = nextKind ? getNode(nextKind) : null;
  if (!nextNode) return <span className="btn" style={{ color: 'var(--ink-4)' }}>最后一个节点</span>;
  // 当前节点未解锁时，下一节点必然也未解锁；按钮整体应表达"先回上游"
  const nextLocked = currentLocked || Boolean(nextLockedReason && nextLockedReason.length);
  if (!nextLocked) {
    return (
      <Link href={`/project/${projectSlug}/${nextNode.kind}`} className="btn btn-accent">
        继续 · {nextNode.num} {nextNode.label}
        <Chevron />
      </Link>
    );
  }
  const blockedBy = currentLocked ? currentMissing : nextLockedReason;
  const firstMissing = currentLocked && currentMissing?.length ? getNode(currentMissing[0]) : null;
  return (
    <span
      className="btn btn-accent is-disabled"
      role="button"
      aria-disabled="true"
      title={blockedBy && blockedBy.length ? `先完成 ${nodeNames(blockedBy)} 才能继续` : ''}
    >
      {firstMissing ? `先完成 ${firstMissing.num} ${firstMissing.label}` : `继续 · ${nextNode.num} ${nextNode.label}`}
      <Chevron />
    </span>
  );
}
