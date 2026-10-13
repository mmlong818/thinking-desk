import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { TopBar } from '@/components/shell/TopBar';
import { NavRail } from '@/components/shell/NavRail';
import { BriefNode } from '@/components/nodes/BriefNode';
import { UsersNode } from '@/components/nodes/UsersNode';
import { StakeholdersNode } from '@/components/nodes/StakeholdersNode';
import { AlternativesNode } from '@/components/nodes/AlternativesNode';
import { ScenariosNode } from '@/components/nodes/ScenariosNode';
import { FeaturesNode } from '@/components/nodes/FeaturesNode';
import { LeapNode } from '@/components/nodes/LeapNode';
import { FinalFeaturesNode } from '@/components/nodes/FinalFeaturesNode';
import { SplitNode } from '@/components/nodes/SplitNode';
import { LockedNode } from '@/components/nodes/LockedNode';
import { ProjectStoreProvider, type ProjectSnapshot } from '@/components/project/ProjectStore';
import { NODES, getNode, isNodeLocked, missingDeps, type NodeKind } from '@/data/nodes';
import { findProjectBySlug } from '@/lib/db/projects';
import { PgRepository } from '@/lib/db/pg-repository';
import { completedNodes } from '@/lib/model/completion';
import { localProjectId } from '@/lib/model/local-repository';
import { cookieNameCandidates, parseCompletionCookie } from '@/lib/store/completion-cookie';
import type { StoreRef } from '@/lib/store/store-ref';

export const dynamic = 'force-dynamic';

interface ProjectInfo {
  name: string;
  slug: string;
  store: StoreRef;
}

/**
 * Postgres mode when the project row is found (the same test the app always used to decide
 * whether a database exists); otherwise pure-local mode keyed by the decoded slug.
 */
async function loadProject(slug: string): Promise<ProjectInfo> {
  try {
    // Route params arrive percent-encoded for non-ASCII slugs (e.g. 冒烟分支-6e50); rows hold the decoded slug.
    const p = await findProjectBySlug(localProjectId(slug));
    if (p) return { name: p.name, slug: p.slug, store: { mode: 'pg', projectId: p.id } };
  } catch {
    // DB unavailable — fall through.
  }
  return { name: nameFromSlug(slug), slug, store: { mode: 'local', projectId: localProjectId(slug) } };
}

/**
 * Slug 是 Home.tsx 由名称生成（中文保留 + 4 位随机后缀）。
 * DB 不可达时反解：去掉末尾的 -xxxx 随机后缀，把 - 还原成空格。
 */
function nameFromSlug(slug: string): string {
  const decoded = localProjectId(slug);
  const stripped = decoded.replace(/-[a-z0-9]{4}$/i, '');
  const name = stripped.replace(/-+/g, ' ').trim();
  return name || decoded;
}

async function loadSnapshot(store: StoreRef): Promise<ProjectSnapshot | null> {
  if (store.mode !== 'pg') return null;
  try {
    const repo = new PgRepository();
    const [graph, runs] = await Promise.all([repo.getGraph(store.projectId), repo.listRuns(store.projectId)]);
    return { ...graph, runs };
  } catch {
    return null;
  }
}

/** Completion for the lock screen: derived from items in Postgres mode, the td-done cookie otherwise. */
async function loadCompleted(slug: string, graph: ProjectSnapshot | null): Promise<NodeKind[]> {
  if (graph) {
    const done = completedNodes(graph.items);
    return NODES.filter((n) => done.has(n.kind)).map((n) => n.kind);
  }
  const cookieStore = await cookies();
  for (const name of cookieNameCandidates(slug)) {
    const v = cookieStore.get(name)?.value;
    if (v) return parseCompletionCookie(v);
  }
  return [];
}

const NODE_COMPONENTS: Record<NodeKind, () => React.ReactNode> = {
  brief: () => <BriefNode />,
  users: () => <UsersNode />,
  stake: () => <StakeholdersNode />,
  alt: () => <AlternativesNode />,
  scen: () => <ScenariosNode />,
  feat: () => <FeaturesNode />,
  leap: () => <LeapNode />,
  final: () => <FinalFeaturesNode />,
  split: () => <SplitNode />,
};

export default async function NodePage({ params }: { params: Promise<{ id: string; node: string }> }) {
  const { id, node } = await params;
  const def = getNode(node);
  if (!def) notFound();

  const project = await loadProject(id);
  const graph = await loadSnapshot(project.store);
  const completed = await loadCompleted(project.slug, graph);
  const completedSet = new Set<NodeKind>(completed);
  const lockedKinds = NODES.filter((n) => isNodeLocked(n.kind, completedSet)).map((n) => n.kind);
  const currentLocked = lockedKinds.includes(def.kind);
  const currentMissing = missingDeps(def.kind, completedSet);
  const next = NODES.find((n) => n.num > def.num);
  const nextMissing = next ? missingDeps(next.kind, completedSet) : [];

  // The provider wraps the whole page: the top bar's consistency panel reads the project too, and
  // on the lock screen it re-derives completion from localStorage (pure-local mode) and refreshes
  // the page when the cookie was stale or missing.
  return (
    <ProjectStoreProvider store={project.store} slug={project.slug} initial={graph} completed={completed}>
      <div className="app">
        <TopBar
          projectName={project.name}
          projectSlug={project.slug}
          nodeKind={def.kind}
          currentLocked={currentLocked}
          currentMissing={currentMissing}
          nextLockedReason={nextMissing.length ? nextMissing : null}
          store={project.store}
        />
        <div className="main">
          <NavRail
            projectSlug={project.slug}
            projectName={project.name}
            active={def.kind}
            completed={completed}
            lockedKinds={lockedKinds}
            store={project.store}
          />
          {currentLocked ? (
            <LockedNode projectSlug={project.slug} current={def.kind} missing={currentMissing} />
          ) : (
            NODE_COMPONENTS[def.kind]()
          )}
        </div>
      </div>
    </ProjectStoreProvider>
  );
}

export function generateStaticParams() {
  return NODES.map((n) => ({ node: n.kind }));
}
