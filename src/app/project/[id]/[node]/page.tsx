import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { cookieNameCandidates } from '@/lib/client-cache';
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
import type { FinalContent } from '@/components/nodes/FinalFeaturesNode';
import { SplitNode } from '@/components/nodes/SplitNode';
import { PlaceholderNode } from '@/components/nodes/PlaceholderNode';
import { LockedNode } from '@/components/nodes/LockedNode';
import { NODES, getNode, isNodeLocked, missingDeps, type NodeKind } from '@/data/nodes';
import { findProjectBySlug, getNode as getNodeRow } from '@/lib/db/projects';
import type { BriefExtraction } from '@/lib/ai/schemas/extract-brief';
import type { Persona, UsersAnalysis } from '@/lib/ai/schemas/analyze-users';
import type { StakeholdersAnalysis } from '@/lib/ai/schemas/analyze-stakeholders';
import type { AlternativesAnalysis } from '@/lib/ai/schemas/analyze-alternatives';
import type { ScenarioDraft, ScenarioDeepAnalysis } from '@/lib/ai/schemas/analyze-scenarios';
import type { FeatureList } from '@/lib/ai/schemas/draft-features';
import type { CreativeLeapAnalysis } from '@/lib/ai/schemas/creative-leap';
import type { DesignProposal } from '@/lib/ai/schemas/generate-design';
import type { SubfeatureBreakdown } from '@/lib/ai/schemas/split-subfeatures';
import type { ClarifierAnswer } from '@/components/nodes/BriefClarifier';

export const dynamic = 'force-dynamic';

interface BriefContent extends BriefExtraction {
  raw_text?: string;
  answers?: ClarifierAnswer[];
}

interface UsersContent extends UsersAnalysis {
  locked?: Record<string, boolean>;
  source_brief_snapshot?: BriefExtraction;
  extraPersonas?: Persona[];
  personaLocked?: Record<string, boolean>;
  jobLocked?: Record<string, boolean>;
}
interface StakeContent extends StakeholdersAnalysis {
  selected?: Record<string, boolean>;
}

async function loadProject(slug: string) {
  try {
    const p = await findProjectBySlug(slug);
    if (p) return { id: p.id, name: p.name, slug: p.slug };
  } catch {
    // DB unavailable — fall through.
  }
  return { id: null, name: nameFromSlug(slug), slug };
}

/**
 * Slug 是 Home.tsx 由名称生成（中文保留 + 4 位随机后缀）。
 * DB 不可达时反解：去掉末尾的 -xxxx 随机后缀，把 - 还原成空格。
 */
function nameFromSlug(slug: string): string {
  const decoded = (() => {
    try { return decodeURIComponent(slug); } catch { return slug; }
  })();
  const stripped = decoded.replace(/-[a-z0-9]{4}$/i, '');
  const name = stripped.replace(/-+/g, ' ').trim();
  return name || decoded;
}

async function loadNode<T>(projectId: string | null, kind: NodeKind | 'design'): Promise<T | undefined> {
  if (!projectId) return undefined;
  try {
    const row = await getNodeRow<T>(projectId, kind);
    return row?.content;
  } catch {
    return undefined;
  }
}

export default async function NodePage({ params }: { params: Promise<{ id: string; node: string }> }) {
  const { id, node } = await params;
  const def = getNode(node);
  if (!def) notFound();

  const project = await loadProject(id);

  const [brief, users, stake, alt, scen, feat, leap, final, design, split] = await Promise.all([
    loadNode<BriefContent>(project.id, 'brief'),
    loadNode<UsersContent>(project.id, 'users'),
    loadNode<StakeContent>(project.id, 'stake'),
    loadNode<AlternativesAnalysis>(project.id, 'alt'),
    loadNode<{ scenarios: ScenarioDraft[]; picked_scenario_ids: string[]; deep: ScenarioDeepAnalysis }>(
      project.id, 'scen',
    ),
    loadNode<FeatureList>(project.id, 'feat'),
    loadNode<CreativeLeapAnalysis>(project.id, 'leap'),
    loadNode<FinalContent>(project.id, 'final'),
    loadNode<DesignProposal>(project.id, 'design'),
    loadNode<SubfeatureBreakdown>(project.id, 'split'),
  ]);

  const completed: NodeKind[] = [];
  if (brief) completed.push('brief');
  if (users) completed.push('users');
  if (stake) completed.push('stake');
  if (alt) completed.push('alt');
  if (scen) completed.push('scen');
  if (feat) completed.push('feat');
  if (leap) completed.push('leap');
  if (final) completed.push('final');
  if (split) completed.push('split');

  // Pure-local mode: when DB is unavailable, the client mirrors completion
  // into a `td-done:<slug>` cookie (or `td-done-h:<hash>` for long slugs).
  // Trust it for unlock decisions only — node bodies still hydrate content
  // from sessionStorage on the client.
  const cookieStore = await cookies();
  const doneCookie = (() => {
    for (const name of cookieNameCandidates(project.slug)) {
      const v = cookieStore.get(name)?.value;
      if (v) return v;
    }
    return undefined;
  })();
  if (doneCookie) {
    for (const k of doneCookie.split(',')) {
      const kind = k as NodeKind;
      if (!completed.includes(kind) && NODES.some((n) => n.kind === kind)) {
        completed.push(kind);
      }
    }
  }

  const briefSnapshot: BriefExtraction | null = brief
    ? {
        highlights: brief.highlights,
        fields: brief.fields,
        follow_ups: brief.follow_ups,
        completeness: brief.completeness,
      }
    : null;

  const finalWithDesign: FinalContent | undefined = final
    ? { ...final, design: final.design ?? design }
    : design
    ? ({
        features: [], pillars: [], not_doing: [], differentiation_echo: '',
        revision: { revisions: [], summary: '', selected_leap_ids: [], revised_at: '' },
        design,
      } as FinalContent)
    : undefined;

  const completedSet = new Set<NodeKind>(completed);
  const lockedSet = new Set<NodeKind>(NODES.filter((n) => isNodeLocked(n.kind, completedSet)).map((n) => n.kind));
  const currentLocked = lockedSet.has(def.kind);
  const currentMissing = missingDeps(def.kind, completedSet);

  let nodeEl: React.ReactNode;
  if (currentLocked) {
    nodeEl = <LockedNode projectSlug={project.slug} current={def.kind} missing={currentMissing} />;
  } else if (def.kind === 'brief') {
    nodeEl = <BriefNode projectSlug={project.slug} initial={brief} />;
  } else if (def.kind === 'users') {
    nodeEl = <UsersNode projectSlug={project.slug} brief={briefSnapshot} initial={users} />;
  } else if (def.kind === 'stake') {
    nodeEl = (
      <StakeholdersNode
        projectSlug={project.slug}
        brief={briefSnapshot}
        usersContent={users ?? null}
        initial={stake}
      />
    );
  } else if (def.kind === 'alt') {
    nodeEl = (
      <AlternativesNode
        projectSlug={project.slug}
        brief={briefSnapshot}
        usersContent={users ?? null}
        initial={alt}
      />
    );
  } else if (def.kind === 'scen') {
    nodeEl = (
      <ScenariosNode
        projectSlug={project.slug}
        brief={briefSnapshot}
        usersContent={users ?? null}
        initial={scen}
      />
    );
  } else if (def.kind === 'feat') {
    nodeEl = (
      <FeaturesNode
        projectSlug={project.slug}
        brief={briefSnapshot}
        usersContent={users ?? null}
        scenContent={scen ?? null}
        altContent={alt ?? null}
        initial={feat}
      />
    );
  } else if (def.kind === 'leap') {
    nodeEl = (
      <LeapNode
        projectSlug={project.slug}
        brief={briefSnapshot}
        usersContent={users ?? null}
        featContent={feat ?? null}
        altContent={alt ?? null}
        initial={leap}
      />
    );
  } else if (def.kind === 'final') {
    nodeEl = (
      <FinalFeaturesNode
        projectSlug={project.slug}
        initial={finalWithDesign}
        featContent={feat ?? null}
        leapContent={leap ?? null}
        brief={briefSnapshot}
      />
    );
  } else if (def.kind === 'split') {
    nodeEl = (
      <SplitNode
        projectSlug={project.slug}
        initial={split}
        designContent={design ?? finalWithDesign?.design ?? null}
      />
    );
  } else {
    nodeEl = <PlaceholderNode kind={def.kind} />;
  }

  return (
    <div className="app">
      <TopBar
        projectName={project.name}
        projectSlug={project.slug}
        nodeKind={def.kind}
        currentLocked={currentLocked}
        currentMissing={currentMissing}
        nextLockedReason={(() => {
          const next = NODES.find((n) => n.num > def.num);
          if (!next) return null;
          const miss = missingDeps(next.kind, completedSet);
          return miss.length ? miss : null;
        })()}
      />
      <div className="main">
        <NavRail
          projectSlug={project.slug}
          projectName={project.name}
          active={def.kind}
          completed={completed}
          lockedKinds={Array.from(lockedSet)}
        />
        {nodeEl}
      </div>
    </div>
  );
}

export function generateStaticParams() {
  return NODES.map((n) => ({ node: n.kind }));
}
