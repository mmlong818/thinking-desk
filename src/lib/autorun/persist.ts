import { NODES, type NodeKind } from '@/data/nodes';
import {
  adaptAlternatives, adaptDeepAnalysis, adaptDesignProposal, adaptDimensions, adaptExtractBrief, adaptFeatureList,
  adaptFeatureRevision, adaptLeapAnalysis, adaptScenarioDrafts, adaptStakeholders, adaptSubfeatureBreakdown,
  adaptUsersAnalysis, type AdaptedOutput,
} from '../model/adapters';
import { inputsOf } from '../model/context';
import type { Repository, SaveRunResult } from '../model/repository';
import { toRunInput } from '../model/run-meta';
import type { Item } from '../model/item-types';
import type { ItemType } from '../model/types';
import {
  acceptedFeatures, lockedJobs, MAX_DEEP, pickElements, selectedLeapIds, STEPS,
  type Ctx, type Outputs, type StepName, type StepRecord,
} from './chain';
import { withPermanentIds } from './permanent-ids';

// Stores each chain step the way the node UI would: the run and its items (saveRunOutput), then
// the judgment the chain simulated, recorded as AI decisions (actor 'ai') so they stay apart from
// the person's. Accepted: what the AI recommends plus what the chain fed downstream; a completion
// clause still unmet takes every item this run produced for it, so the next node unlocks.

export const AUTORUN_NOTE = 'autorun 自动采纳';

interface StepSave<K extends StepName> {
  node: NodeKind;
  adapt(out: Outputs[K], ctx: Ctx): AdaptedOutput;
  /** Items the chain passed on to later steps (temp refs, before the permanent-id rewrite). */
  chosen?(out: Outputs[K]): { types: readonly ItemType[]; refs: readonly string[] };
}

const LEAP_TYPES: readonly ItemType[] = ['first_principle', 'analogy', 'constraint_flip'];

const SAVES: { [K in StepName]: StepSave<K> } = {
  brief: { node: 'brief', adapt: (o, c) => adaptExtractBrief(o, { rawText: c.rawText, answers: [] }) },
  users: { node: 'users', adapt: adaptUsersAnalysis, chosen: (o) => ({ types: ['job'], refs: lockedJobs(o).map((j) => j.id) }) },
  stake: { node: 'stake', adapt: adaptStakeholders },
  alt: { node: 'alt', adapt: adaptAlternatives },
  scen_exhaust: { node: 'scen', adapt: adaptDimensions, chosen: (o) => ({ types: ['scenario_element'], refs: pickElements(o) }) },
  scen_combine: {
    node: 'scen', adapt: adaptScenarioDrafts,
    chosen: (o) => ({ types: ['scenario'], refs: o.scenarios.slice(0, MAX_DEEP).map((s) => s.id) }),
  },
  scen_deep: { node: 'scen', adapt: adaptDeepAnalysis },
  features: { node: 'feat', adapt: adaptFeatureList, chosen: (o) => ({ types: ['feature'], refs: acceptedFeatures(o.features).map((f) => f.id) }) },
  leap: { node: 'leap', adapt: adaptLeapAnalysis, chosen: (o) => ({ types: LEAP_TYPES, refs: selectedLeapIds(o) }) },
  revise: {
    node: 'final',
    // ctx.out.features already carries permanent ids: the originals the revision was asked about.
    adapt: (o, c) => adaptFeatureRevision(o, { originalFeatureIds: acceptedFeatures(c.out.features?.features ?? []).map((f) => f.id) }),
    chosen: (o) => ({ types: ['feature'], refs: acceptedFeatures(o.revised_features).map((f) => f.id) }),
  },
  design: { node: 'final', adapt: adaptDesignProposal },
  split: { node: 'split', adapt: adaptSubfeatureBreakdown },
};

const STEP_NODE = (step: StepName): NodeKind => SAVES[step].node;

/** Accepted, live items of the nodes the step's prompt quotes (the run's inputs, for staleness). */
function inputsFor(step: StepName, items: readonly Item[]) {
  const nodes = new Set(STEPS[step].reads.map(STEP_NODE));
  return inputsOf(items.filter((i) => !i.deletedAt && i.decision === 'accepted' && nodes.has(i.node)));
}

/** Ids this run's judgment accepts (see the header). */
export function itemsToAccept(
  node: NodeKind, produced: readonly Item[], existing: readonly Item[], chosenIds: ReadonlySet<string>,
): string[] {
  const open = produced.filter((i) => !i.deletedAt && i.node === node && i.decision === 'pending' && i.type !== 'finding');
  const take = new Set(open.filter((i) => i.aiStance?.verdict === 'recommend' || chosenIds.has(i.id)).map((i) => i.id));
  const def = NODES.find((n) => n.kind === node);
  for (const clause of def?.completion ?? []) {
    const met = (i: Item) => clause.anyOf.includes(i.type) && (take.has(i.id) || (i.decision === 'accepted' && !i.deletedAt && i.node === node));
    if ([...existing, ...open].filter(met).length >= clause.min) continue;
    for (const i of open) if (clause.anyOf.includes(i.type)) take.add(i.id);
  }
  return [...take];
}

function chosenIds(step: StepName, data: unknown, idMap: SaveRunResult['idMap']): Set<string> {
  const pick = (SAVES[step] as StepSave<StepName>).chosen?.(data as Outputs[StepName]);
  if (!pick) return new Set();
  return new Set(pick.types.flatMap((t) => pick.refs.flatMap((r) => idMap[`${t}:${r}`] ?? [])));
}

/**
 * Saves one step's record (a failed step as a failed run), accepts per the simulated judgment and,
 * on success, rewrites ctx.out[step] to permanent ids for the steps that quote it.
 */
export async function persistStep(repo: Repository, projectId: string, ctx: Ctx, record: StepRecord): Promise<void> {
  const node = STEP_NODE(record.step);
  if (!record.run) return;
  const before = await repo.listItems(projectId);
  const run = toRunInput(record.run, { node, inputs: inputsFor(record.step, before) });
  if (record.status === 'failed' || record.data === undefined) {
    await repo.saveRunOutput(projectId, { run, drafts: [], replace: [] });
    return;
  }
  const save = SAVES[record.step] as StepSave<StepName>;
  const adapted = save.adapt(record.data as Outputs[StepName], ctx);
  const result = await repo.saveRunOutput(projectId, { run, drafts: adapted.drafts, replace: adapted.replace });
  const produced = [...result.created, ...result.updated];
  const accept = itemsToAccept(node, produced, before, chosenIds(record.step, record.data, result.idMap));
  for (const id of accept) {
    await repo.updateItem(projectId, id, { decision: 'accepted' }, { actor: 'ai', note: AUTORUN_NOTE });
  }
  (ctx.out as Record<string, unknown>)[record.step] = withPermanentIds(record.data, result.idMap);
}
