import { isProtected } from './ingest';
import type { Item } from './item-types';
import type { ReplaceScope } from './repository';

// Regeneration semantics (docs/data-model.md § "Regeneration"):
//   accepted / rejected / human-touched items survive a regeneration;
//   AI-pending items in the replaced (node, type) scope are retired unless
//   the new output echoed them; rejected items + decisionNote are fed back
//   into the next prompt (prompt side lands with runTask()).

export function inScope(item: Item, scopes: readonly ReplaceScope[]): boolean {
  return scopes.some((s) => s.node === item.node && s.type === item.type);
}

/** Live items a run retires: in scope, AI-pending, not echoed / updated by the run. */
export function retireCandidates(
  live: readonly Item[],
  scopes: readonly ReplaceScope[],
  touched: ReadonlySet<string>,
): Item[] {
  return live.filter((i) => !i.deletedAt && inScope(i, scopes) && !isProtected(i) && !touched.has(i.id));
}
