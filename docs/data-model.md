# Data Model (Phase 1)

Thinking Desk is AI-led and human-judged: the AI produces the breadth (options, analysis, evidence, recommendations), the person accepts, rejects or edits. The data model records both sides — what the AI produced and in which run, and every human judgment — so later features (staleness hints, consistency checks, exports with provenance) can be built on it.

Code: `src/lib/model/` (pure domain + `LocalRepository`), `src/lib/db/pg-repository.ts` (`PgRepository`), `src/lib/db/schema.sql`. Completion rules: `src/data/nodes.ts`.

Status: every node reads and writes items through the repositories (milestone 3a, see [Migration status](#migration-status)); how the UI uses the model is in [UI on the model](#ui-on-the-model). Phase 3 added staleness UI, hand-edited Links, consistency findings and source checks (sections below); exports are described in [exports.md](exports.md).

## Entities

### Item

Every unit of content — a persona, a job, a feature, a design section — is an Item.

| Field | Type | Notes |
|---|---|---|
| `id` | string | `<prefix>_<8 base36 chars>`, e.g. `job_k3f9a2x1`. System-assigned, permanent, unique per project. |
| `projectId` | string | |
| `node` | `NodeKind` | The node the item belongs to. Some types live on several nodes (`feature` on `feat` and `final`). |
| `type` | `ItemType` | Selects the body schema (see [Item types](#item-types)). |
| `body` | object | Validated by the per-type Zod registry `ITEM_TYPE_DEFS`. |
| `origin` | `ai` \| `human` \| `ai_edited` | `ai_edited` = AI-produced, then edited by a person. |
| `decision` | `pending` \| `accepted` \| `rejected` | The human judgment. |
| `decisionNote?` | string | Reason for the current decision; rejected notes feed the next prompt. |
| `aiStance?` | `{ verdict: recommend\|neutral\|caution, reason }` | The AI's own recommendation (e.g. today's `suggested_priority`). |
| `evidence?` | `{ basis: web\|model_knowledge\|user_input, confidence?: 0..1, sources: {title, url?, verified, status?, checkedAt?, pageTitle?, detail?}[] }` | `confidence` is optional: sources lifted from output that states none carry none. `status` = last [source check](#source-checks) (`title_match` \| `reachable` \| `unreachable` \| `blocked`); `verified` is true only for `title_match`. |
| `version` | int ≥ 1 | Bumped only when the body changes. |
| `runId?` | string | The run that last wrote the body. Absent for human items. |
| `createdAt`, `updatedAt`, `deletedAt?` | ISO timestamp | `deletedAt` = soft delete. Items are never hard-deleted. |

The TypeScript `Item` type is a union discriminated on `type`, so narrowing `item.type === 'job'` narrows `item.body`.

### Link

`from` depends on `to`.

| Field | Notes |
|---|---|
| `id`, `projectId`, `from`, `to` | Item ids. |
| `rel` | `derived_from` \| `serves` \| `addresses` \| `implements` \| `mitigates` \| `conflicts_with` \| `assumes` \| `depends_on` |
| `toVersionSeen` | Version of `to` when the link was made or last reviewed. |

Staleness is computed, never stored: a link is stale when `to.version > toVersionSeen`. `refreshLinks()` marks a link reviewed (`toVersionSeen := to.version`, one `link_confirmed` event per link that moved).

Links come from AI runs (the ref fields below) and from hand edits (`editLinks`). Which (from type, rel, to type) pairs may exist is one table, `LINK_RULES` in `src/lib/model/link-rules.ts`: the type registry's ref fields plus the links adapters supply (brief —assumes→ assumption, feature@final —derived_from→ feature@feat). Hand edits and human-created items are held to it, and `depends_on` links may not close a cycle.

| rel | Meaning | Example |
|---|---|---|
| `derived_from` | provenance: produced from / composed of | job → persona, scenario → scenario_element |
| `serves` | exists to satisfy a need | feature → job, scenario → job |
| `addresses` | responds to a problem | insight → pain_point |
| `implements` | realizes | module → feature, subtask → feature |
| `mitigates` | reduces a risk | (reserved for risk items) |
| `conflicts_with` | in tension with | finding → each item it involves |
| `assumes` | relies on an assumption | brief → assumption |
| `depends_on` | ordering between peers | module → module, subtask → subtask |

### Run

One record per AI call; replaces the `ai_exchanges` log. Append-only.

| Field | Notes |
|---|---|
| `id`, `projectId`, `task` (AiTask), `node` | `task` is stored as a string so runs of later-pruned tasks still load. |
| `provider`, `model`, `promptVersion` | `promptVersion` = hash of the prompt template. |
| `inputs` | `{ itemId, version }[]` — the items fed into the prompt. |
| `status` | `ok` \| `retried` \| `failed`; `error?` |
| `usage?` | `{ inputTokens, outputTokens }` |
| `latencyMs`, `createdAt` | |

### DecisionEvent

Append-only audit trail: `id, projectId, itemId, kind, fromVersion, toVersion, note?, prevBody?, link?, actor (human|ai), at`.

`prevBody` holds the body before an `edited` event — human edits and AI rewrites alike — when it serializes to at most 16,000 characters (`PREV_BODY_MAX_CHARS`); an AI run that rewrites a **singleton** in place always keeps it, whatever the size, so a judged brief / engagement plan / differentiation hypothesis that a re-run overwrote stays recoverable without a snapshot table. `bodyAtVersion(events, itemId, v)` reads the body an item had at version `v` (the upstream before / after view of the staleness UI). Events written before phase 3 have `prevBody` only on singleton rewrites.

`link` (`{ id, to, rel }`) is set on the three link kinds: `link_added`, `link_removed`, `link_confirmed` — the event's item is the link's `from`; they never change a version.

| Operation | Events |
|---|---|
| AI run creates an item | `created` 0→1, actor ai |
| AI run rewrites an echoed AI-pending item | `edited` v→v+1 with `prevBody` (size-capped), actor ai |
| AI run rewrites a singleton | `edited` v→v+1 with `prevBody`, actor ai; plus `reset` if it was accepted/rejected |
| AI run retires a superseded pending item | `deleted`, actor ai, note `superseded by run <id>` |
| Human creates an item | `created` 0→1, plus `accepted`/`rejected` if not pending |
| Human edits the body | `edited` v→v+1 with `prevBody` (size-capped) (origin `ai` → `ai_edited`; decision unchanged) |
| Human accepts / rejects / resets | `accepted` / `rejected` / `reset`, from = to = current version |
| Human "accept all recommended" on a node | one `accepted` per item, actor human, note `accept all recommended` |
| Human changes only the note | the current decision's event again, with the new note |
| Human adds / removes a Link (`editLinks`) | `link_added` / `link_removed` on the `from` item, with `link` |
| Human confirms an item still holds after its upstream changed (`refreshLinks`) | `link_confirmed` per link that moved, with `link` |
| Evidence replaced (`patch.evidence`, e.g. a source check) | `evidence_updated`, from = to = current version |
| Soft delete | `deleted` |

A no-op patch writes nothing.

## Item types

Bodies are derived from the task response schemas in `src/lib/ai/schemas/`: `id` and cross-reference fields are omitted (Zod strips them; Links replace them).

| Node | Type (prefix) | Body source | Cross-refs → Links |
|---|---|---|---|
| brief | `brief` (brf) **singleton** | `raw_text`, `fields` (minus `red_lines`), `highlights` (fact/missing), `follow_ups`, `completeness`, `answers`, `follow_up_answers` | — |
| brief | `red_line` (red) | `{ text }` from `fields.red_lines[]` | — |
| any | `assumption` (asm) | `{ statement, quote?, rationale?, signal?, threshold?, status: untested\|validated\|refuted\|evolved }`; from `assumption` highlights (replaces the `assumptions` table) | brief —assumes→ assumption (adapter-supplied) |
| users | `persona` (per) | `PersonaSchema` | — |
| users | `job` (job) | `JobSchema` + `dimension` (functional/emotional/social) | `persona_ids` → derived_from persona |
| stake | `stakeholder` (stk) | `StakeholderSchema` | — |
| stake | `engagement_plan` (eng) **singleton** | `EngagementPlanSchema` | — |
| alt | `alternative` (alt) | `AlternativeSchema`; the cited URLs move to `evidence.sources` (basis `web`, unchecked) and `body.sources` stays empty — alternatives saved before keep their body URLs (a source check reads them) | — |
| alt | `alt_profile` (apf) | `StrategicProfileSchema` | `alt_id` → derived_from alternative |
| alt | `alt_breakdown` (abd) | `FeatureBreakdownSchema` | `alt_id` → derived_from alternative |
| alt | `diff_hypothesis` (dif) **singleton** | `{ statement, key_threats[] }` | — |
| scen | `scenario_element` (sel) | `ElementSchema` + `dim` | — |
| scen | `scenario` (scn) | `ScenarioDraftSchema` | `element_ids` → derived_from scenario_element; `job_ids` → serves job |
| scen | `matrix_cell` (mtx) | `MatrixCellSchema` | `scenario_id`, `job_id` → derived_from |
| scen | `extreme` (ext), `hostile` (hst) | `ExtremeScenarioSchema`, `HostileScenarioSchema` | — |
| scen | `pain_point` (pan), `delight_point` (dlt) | `PainPointSchema`, `DelightPointSchema` | `scenario_id` → derived_from scenario |
| scen | `insight` (ins) | `DesignInsightSchema` | `scenario_id` → derived_from; `job_id` → serves job; `pain_id` → addresses pain_point |
| feat, final | `pillar` (pil), `not_doing` (nod) | `PillarSchema`, `NotDoingSchema` | — |
| feat, final | `feature` (ftr) | `FeatureSchema` | `traces.insight_ids`/`scenario_ids` → derived_from; `traces.job_ids`/`persona_ids` → serves |
| leap | `first_principle` (fpr), `analogy` (ana), `constraint_flip` (flp) | leap schemas + optional `required_changes` | — |
| final | `revision` (rev) | `RevisionNoteSchema` | `feature_id` → derived_from feature@final; `original_feature_id` → derived_from feature@feat; `source_leap_ids` → derived_from leap items |
| final | `design_section` (dsn) | union on `kind`: overview, principles, ia, flow, interaction, data_entity, tech, metric, risk, milestone, open_question | — |
| final | `module` (mod) | `ModuleSchema` | `feature_ids` → implements feature; `depends_on` → depends_on module |
| split | `subtask` (tsk) | `SubFeatureSchema` + `feature_name?`, `critical` | `feature_id` → implements; `module_id` → derived_from module; `dependencies` → depends_on subtask |
| any | `summary` (sum) | `{ topic: priority\|differentiation_echo\|leap_timing\|revision\|split, text, verdict? }` | — |
| any | `critique` (crt) | `{ kind: check\|critique\|ask, title, body }` | — |
| any | `finding` (fnd) | `{ title, description, severity: high\|medium\|low, suggested_fix }` (CONSISTENCY_CHECK) | `item_ids` → conflicts_with any content type (`FINDING_TARGET_TYPES`) |

Rule of thumb: an item is something a person can judge on its own. Run-level AI prose (priority summaries, echoes, timing verdicts) becomes `summary` items so it is versioned and exportable, but never gates completion. Process artefacts (clarify questionnaires, interview turns, derived follow-up questions) are not items; their answers land in item bodies (`brief.answers`, `brief.follow_up_answers`).

## Node completion

Completion is derived from items: a node is complete when every clause of its `completion` rule in `src/data/nodes.ts` holds — "≥ `min` live, accepted items on this node whose type is in `anyOf`". `completedNodes(items)` computes the set; locking still uses `deps`.

| Node | Complete when (accepted, on the node) |
|---|---|
| brief | 1 `brief` |
| users | ≥1 `persona` **and** ≥1 `job` |
| stake | ≥1 `stakeholder` |
| alt | ≥1 `alternative` **and** the `diff_hypothesis` |
| scen | ≥1 `scenario` **and** ≥1 `insight` |
| feat | ≥1 `feature` |
| leap | ≥1 of `first_principle` / `analogy` / `constraint_flip` |
| final | ≥1 `module` **and** ≥1 `design_section` |
| split | ≥1 `subtask` |

The `td-done:<slug>` cookie stays, but only as a cache for SSR lock decisions in pure-local mode: after every write the browser overwrites it with `completionCookieValue(completedNodes(items))` (`writeCompletionCookie`, `src/lib/store/completion-cookie.ts`) — so un-accepting the last item of a node relocks what depends on it — and refreshes the page when the set changed. In Postgres mode the page derives completion from the items it loads.

The rules stay deliberately minimal. What a good node *should* also have is reported separately as **hints** that never block completion or locking: `nodeHints(kind, items)` / `projectHints(items)` in `src/lib/model/hints.ts`, judged on live accepted items and silent for a node that has no items yet.

| Node | Hint (`code`) when nothing accepted covers it |
|---|---|
| brief | no `red_line` (`brief.no_red_line`); brief without `success_criteria` (`brief.no_success_criteria`) |
| users | no emotional `job` (`users.no_emotional_job`) |
| stake | each baseline category missing among stakeholders: sponsor, maker, business, compliance, user (`stake.missing_baseline`, `params.category`) |
| alt | no `non_consumption` alternative (`alt.no_non_consumption`) |
| scen | no `hostile` scenario (`scen.no_hostile`) |
| feat | no `not_doing` (`feat.no_not_doing`) |

AI items are created `pending`. `acceptRecommended(projectId, node)` accepts, atomically, every live pending item on the node whose `aiStance.verdict` is `recommend` (one `accepted` event each, actor human) — the "✓ 采纳全部推荐（N）" button of every node's judge bar, disabled when N = 0. Consistency findings never take part (they are judged in the consistency panel). Hints are shown under it as non-blocking notices.

## AI temp ids → permanent ids and Links

AI output keeps using short temporary ids (`p1`, `j3`, `sc-1`) and cross-refs between them (`persona_ids`, `job_ids`, `scenario_id`, `element_ids`, `alt_id`, `feature_ids`, `source_id`, …). Prompts present existing items by their permanent id. A task adapter (`src/lib/model/adapters/`, one per task output, client-safe) turns each output entity into an `ItemDraft { ref, type, node?, body, aiStance?, evidence?, links? }` where `body` is the raw entity; the registry knows which fields are refs. At save time, inside the same transaction:

1. **Classify each draft** (validate node + body first; invalid drafts are skipped and reported):
   - singleton type with a live item on the node → **update** that item in place;
   - `ref` equals a live item's permanent id of the same type and node (an *echo*) → **update** if that item is AI-pending, otherwise **keep** it untouched (judged or human-touched items are never rewritten by a run);
   - otherwise → **new** item with a fresh `<prefix>_<random>` id.
2. **Map temp ids**: `idMap["<type>:<ref>"] = permanentId`. Temp ids are scoped by type, so a persona `a` and a job `a` do not collide; duplicate temp ids keep the first and are reported.
3. **Resolve refs into Links**: for each declared ref field (and adapter-supplied `links`, e.g. lineage of a revised feature), resolve the value against this output's `idMap` first, then against live items by permanent id; the target type (and, where declared, node) must match. `revision.original_feature_id` is pinned to node `feat` so it does not resolve to the revised `final` feature that reused the same id. Self-links and duplicates are dropped; unresolvable values (hallucinated or retired ids) are reported as `unresolved_ref` and skipped — the run still saves.
4. **`toVersionSeen`** = the version the AI actually saw: the target's version in `run.inputs` if present (so an item edited while the AI was running shows up stale immediately), else its current version; for items written by this run, their new version.

`source_id` in the leap `top_picks` is not a Link: the adapter applies it to the referenced draft as `aiStance = { verdict: 'recommend', reason: why }` plus `required_changes` on the body. `suggested_priority` maps to `aiStance.recommend`; `red_line_risk` maps to `aiStance.caution` (with `ethics_concern` as the reason). `critical_path` sets `subtask.critical`.

Per-item stance from the model: DESIGN_PROPOSAL (every part: `overview_stance`, `principles_stance`, and a `stance` on each IA section, module, flow, interaction, data entity, tech section, metric, risk, milestone and open question) and SPLIT_SUBFEATURES (each subtask) output `stance: { verdict: recommend | neutral | caution, reason }`, which the adapter copies to `aiStance` (`modelStance()`, `adapters/common.ts`). The field is required in the JSON Schema the provider sees but lenient when parsing (`StanceField`, `schemas/stance.ts`): a missing stance becomes neutral ("AI 未给出判断"), never recommend; it is stripped from the item body.

## Regeneration

`saveRunOutput` takes an explicit `replace: { node, type }[]` scope.

- **Kept**: accepted and rejected items, items with origin `human` or `ai_edited`, and anything the new output echoed.
- **Retired**: AI-pending items in the scope that the new output did not echo — soft-deleted with a `deleted` event (actor ai). Links touching them are removed; new refs to them are dropped.
- **Additive runs** ("give me 3 more personas", leap "more items") pass `replace: []`.
- **Exhaustive scopes** (`{ node, type, exhaustive: true }`, today only the consistency check's `finding` on every node): the output is the complete current set, so an empty answer is valid — the scope's pending items are retired even when the run returned nothing for it, and a run with no drafts at all is recorded `ok` when all its scopes are exhaustive. A run whose drafts were all invalid still fails.
- **Failed runs** are recorded (status `failed`, `error`) and change nothing else.
- **Runs without valid output**: a run that has drafts or a replace scope but yields no valid item (empty output, or every draft rejected) is recorded as `failed` with `error` (`run produced no items` / `run produced no valid items (N drafts rejected)`), whatever status the caller passed, and changes nothing — the pending items it would have replaced stay. A run with neither drafts nor scope (e.g. a clarify run) is recorded as passed.
- **Empty scope**: when a run does yield items but one of its replace scopes got no valid draft, that scope's pending items are kept (not retired) and an `empty_scope` issue is reported; the other scopes regenerate normally.
- **Singletons** (`brief`, `engagement_plan`, `diff_hypothesis`) are rewritten in place, even when judged: version+1, back to `pending`, `edited` + `reset` events. Links into them therefore go stale instead of dangling. The previous body is kept on the `edited` event (`prevBody`); the UI should still confirm before re-running over a judged singleton.

Feedback into the next prompt — `buildFeedback(items, scopes)` in `src/lib/model/feedback.ts`, sent as the optional `feedback` field of every regenerating `/api/ai/*` request and rendered into the prompt as a `regeneration_feedback` data block (`src/lib/ai/feedback-prompt.ts`):

```ts
interface RegenerationFeedback {
  /** Accepted / human-touched items in scope: keep, don't duplicate, may be referenced by id. */
  keep: Array<{ id: string; type: ItemType; summary: string }>;
  /** Rejected items in scope with the human's reason: steer away from these. */
  avoid: Array<{ id: string; type: ItemType; summary: string; note?: string }>;
  /** Kept items whose upstream changed since their Link was made: kept, but the AI may propose an updated version. */
  revisit: Array<{ id: string; type: ItemType; summary: string; changed: string }>;
}
```

`buildFeedback(items, scopes, links)` — every regenerating call passes the links — puts a kept item into `revisit` instead of `keep` when one of its Links is stale; `changed` names the new upstream (type, id, summary). The prompt says: these stay, but they were made from the old upstream; produce an updated item (new id) where the change matters, and do not repeat the ones that still hold. Accepted items are never rewritten by a run, so the person then keeps the old one, the new one, or both.

`summary` is a per-type one-liner (`itemSummary`: persona name + one-liner, job title, …). It replaced the ad-hoc `userLockedJobIds` (refine-jobs now derives its locked list from `feedback.keep`), `locked_ids` and `rejected_ids` request fields, and keeps rejected leaps as data instead of dropping them.

## Staleness

- **Link level** — `isStale(link, items)`, `staleItems(graph)`, `staleIndex(graph)` (`src/lib/model/staleness.ts`): items whose upstream changed after the link was made or reviewed.
- **Run level** — `staleRuns(runs, items)`: runs whose `inputs` changed or were deleted since. `nodeRunStaleness(runs, items, node)` narrows it to what the node notice shows: the newest non-failed **generating** run per task on the node (clarify / probe / free-ask / follow-ups / consistency-check runs are process runs and do not count), and only inputs that live on another node and still exist (inputs on the node itself are covered by item Links). This covers outputs without explicit refs (e.g. personas are generated from the brief but carry no brief ref).

In the UI (`src/components/shared/StaleContent.tsx`): a stale item shows "⟳ 上游已变" next to its decision buttons; its popover lists each changed upstream (`v seen → v now`) with a field-level before / after when the edited event kept the earlier body (`bodyAtVersion`, `bodyDiff`), and two actions — "✓ 确认仍有效" (`refreshLinks`, no AI call) and "⟳ 让 AI 按新内容重做 · <step>" (re-runs the node's existing task: each node page hands its regenerate actions to `NodeFrame` as `redo` handlers keyed by item type; the run uses the usual regeneration semantics and `revisit` feedback). The judge bar of each node shows "上游有 N 处变化" (distinct changed upstream items, item and run level) with the bulk versions of both actions. Confirming run-level changes has no Link to refresh: the confirmation is remembered per browser in the UI cache (`td:ui:<projectId>:stale-ack:<node>`, keyed by the changed inputs and their versions), so it shows again when they change again.

## Consistency checks

Two layers, both non-blocking:

- **Rules** (`ruleFindings(graph)`, `src/lib/model/consistency.ts`) — deterministic, no AI, recomputed whenever the project changes; judged on live accepted items: `feature.no_job` (feature serving no accepted job, info), `module.no_feature` (module implementing no accepted feature), `subtask.no_target` (subtask on no accepted feature or module), `feature.no_subtask` (feature of the revised list on node `final` that no accepted subtask reaches, directly or through an accepted module; info; silent until some subtask is accepted), `feature.red_line_risk` (feature the AI flagged with `red_line_risk`), `finding.unresolved` (an accepted AI finding whose involved items are all still accepted), `link.to_rejected` (accepted item depending on a rejected one). Links into soft-deleted items are not in the live graph; that case shows up through the rules that ask for an accepted target.
- **AI** (`CONSISTENCY_CHECK`, started by hand only) — `consistencyInput(items, links)` (`consistency-context.ts`) digests the downstream context of every node (per node and type the accepted items, or every non-rejected one while none is accepted; never rejected; the feat feature list is left out once node `final` has its own) as one-line `key=value` texts with their Links; the prompt reads them in one `<data>` block and returns 0–12 findings (involved ids, title, description, severity, suggested fix, stance). `adaptConsistencyCheck` turns each into a `finding` item on the most downstream node it cites, linked `conflicts_with` to the cited items; findings citing no known id are dropped. The replace scope is `finding` on every node, exhaustive, so a re-run replaces every pending finding and an empty answer clears them; accepted / rejected findings stay and go back as feedback (keep = do not repeat, avoid = steer away). The run is recorded on the node page it was started from.

UI: under each node's judge bar the rule findings and open AI findings touching the node; the top bar's "一致性 (N)" opens a panel with every rule finding by node and the AI check (button, last run, findings to accept / reject).

## Source checks

`POST /api/sources/verify` (`src/lib/sources/`) checks up to 20 cited URLs per request, 4 at a time: http(s) on default ports, no credentials; local hostnames and private / loopback / link-local / reserved addresses are refused after DNS resolution and again on each of at most 3 redirects; one 8-second budget per URL (DNS, request, body); at most 256 KB read; charset from the header or `<meta>`. The page title is matched loosely against the cited title — or, without one, against what the source is cited for (the alternative's name). Result: `title_match` (verified) / `reachable` / `unreachable` / `blocked`, with a short `detail`. It uses the global fetch, so `NODE_USE_ENV_PROXY` and a proxy dispatcher apply like for AI calls; a DNS-rebinding window between the check's lookup and fetch's own remains. `middleware.ts` rate-limits `/api/sources/*` per IP in its own bucket.

The browser (`src/lib/store/source-check.ts`) collects a node's URLs (`evidence.sources`, or a legacy alternative's body URLs), asks the route, and writes the results onto each item's evidence with `updateItem(…, { evidence })` — no version bump, one `evidence_updated` event. Each source then reads 已核实 / 未核实 / 无法打开 in the UI; the node's judge bar offers "核实本节点来源（N 个链接）".

## Repository

```ts
interface Repository {
  getGraph(projectId): Promise<{ items: Item[]; links: Link[] }>;        // live items + links between them
  listItems(projectId, filter?: { node?, type?, decision?, includeDeleted? }): Promise<Item[]>;
  saveRunOutput(projectId, { run, drafts, replace }): Promise<SaveRunResult>;  // atomic
  updateItem(projectId, itemId, patch: { body?, decision?, decisionNote?, deleted? },
             event: { actor, note? }): Promise<Item>;
  createItem(projectId, { node, type, body, decision?, decisionNote?, links? }): Promise<Item>;
  acceptRecommended(projectId, node, meta?: { note? }): Promise<Item[]>;  // atomic
  refreshLinks(projectId, linkIds, event?: { actor, note? }): Promise<Link[]>;   // + link_confirmed events
  editLinks(projectId, { add?: {from, to, rel}[], remove?: linkId[] }, event): Promise<{ added, removed }>;  // atomic
  listRuns(projectId, filter?): Promise<Run[]>;        // newest first
  listEvents(projectId, filter?): Promise<DecisionEvent[]>;  // append order
}
```

`ItemPatch` = `{ body?, decision?, decisionNote?, deleted?, evidence? }`. `editLinks` removes, then adds (so one edit can move a link); adding an existing (from, to, rel) is a no-op; a pair outside `LINK_RULES` or a self-link is `invalid`, a `depends_on` cycle is `conflict`, an unknown or deleted item / link is `not_found`.

`SaveRunResult` = `{ run, created, updated, retired (ids), links, idMap, issues }`; `issues` covers `invalid_body`, `node_not_allowed`, `duplicate_singleton`, `duplicate_ref`, `unresolved_ref` and `empty_scope`. Errors are `RepositoryError` with `code: not_found | invalid | conflict | storage`. Human items default to `accepted`; creating a second live singleton is a `conflict`.

Both implementations delegate every decision to the same pure planners (`planRunOutput`, `planItemUpdate`, `planCreateItem`, `planRefreshLinks`, `planEditLinks`) and only apply the resulting plan, so they behave identically — an integration test runs the same write sequence against both and compares the results.

**LocalRepository** (pure-local mode, browser): one `localStorage` value per project, `td:v2:<projectId>` → `{ v: 1, items, links, runs, events }`. In pure-local mode the projectId is the **decoded URL slug** — `localProjectId(slug)` applies the same `decodeURIComponent` normalisation as the completion cookie, so encoded and decoded URLs of one project share a key. Each method is a synchronous read-modify-write ending in a single `setItem`, so a failed write (quota) leaves the stored value untouched. Reads validate every record with Zod; invalid records and dangling links are dropped, the original value is copied once to `td:v2-corrupt:<projectId>` and `onCorrupt` is called. A value written by a newer format version is refused rather than overwritten. Storage, clock and id source are injectable. Two tabs writing the same project: last write wins.

**PgRepository** (server): every write runs in one transaction that first locks the project row (`SELECT … FOR UPDATE`), loads the project's items and links, plans, then applies the plan with bulk `jsonb_array_elements` statements in FK-safe order (run → items → links → events). Project ids must be UUIDs. Like every `src/lib/db` caller it rejects (catchably) without `DATABASE_URL`, so pure-local mode and `pnpm build` are unaffected.

**Over HTTP** (Postgres mode): the browser's `HttpRepository` (`src/lib/store/http-repository.ts`) implements the part of the interface the UI uses against these routes; handlers live in `src/lib/api/project-api.ts`, validate bodies with Zod and attribute every write to the human (AI output only arrives as a run):

| Route | Repository call |
|---|---|
| `GET /api/projects/[id]/graph` | `getGraph` |
| `GET /api/projects/[id]/runs?node=` · `POST …/runs` `{ run, drafts, replace }` | `listRuns` · `saveRunOutput` |
| `POST /api/projects/[id]/items` | `createItem` |
| `PATCH /api/projects/[id]/items/[itemId]` `{ patch, note? }` | `updateItem` (actor human; `patch.evidence` replaces the evidence) |
| `POST /api/projects/[id]/links` `{ add?, remove?, note? }` | `editLinks` (actor human) |
| `POST /api/projects/[id]/links/refresh` `{ linkIds, note? }` | `refreshLinks` (actor human) |
| `GET /api/projects/[id]/events?itemId=` | `listEvents` |
| `POST /api/projects/[id]/accept-recommended` `{ node }` | `acceptRecommended` |
| `POST /api/projects/[id]/fork` `{ name, summary? }` | new project + copies of runs, items, links, events (`forkProject`) |
| `DELETE /api/projects/[id]` | deletes the project's decision events, links, items, runs and the project row in one transaction (`deleteProject`, `src/lib/db/delete-project.ts`); 400 for a non-UUID id, 404 when missing |

`RepositoryError` maps to 404 / 400 / 409 / 503; a database failure answers `503 db_unavailable`.

## Postgres DDL

`users` and `projects` are unchanged. `nodes`, `ai_exchanges`, `assumptions` and `comments` are dropped (`DROP TABLE IF EXISTS` — there was no data to migrate; running `pnpm db:init` on an old database removes them). Abridged from `src/lib/db/schema.sql`:

```sql
CREATE TABLE runs (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL, seq BIGINT GENERATED ALWAYS AS IDENTITY,
  task TEXT NOT NULL, node TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
  prompt_version TEXT NOT NULL, inputs JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL CHECK (status IN ('ok','retried','failed')), error TEXT, usage JSONB,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id)
);

CREATE TABLE items (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id TEXT NOT NULL, seq BIGINT GENERATED ALWAYS AS IDENTITY,
  node TEXT NOT NULL, type TEXT NOT NULL, body JSONB NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('ai','human','ai_edited')),
  decision TEXT NOT NULL DEFAULT 'pending' CHECK (decision IN ('pending','accepted','rejected')),
  decision_note TEXT, ai_stance JSONB, evidence JSONB,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1), run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, run_id) REFERENCES runs (project_id, id)
);
CREATE UNIQUE INDEX items_singleton_idx ON items (project_id, node, type)
  WHERE deleted_at IS NULL AND type IN ('brief','engagement_plan','diff_hypothesis');

CREATE TABLE links (
  project_id UUID NOT NULL, id TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
  rel TEXT NOT NULL CHECK (rel IN ('derived_from','serves','addresses','implements',
                                   'mitigates','conflicts_with','assumes','depends_on')),
  to_version_seen INTEGER NOT NULL CHECK (to_version_seen >= 1),
  PRIMARY KEY (project_id, id), UNIQUE (project_id, from_id, to_id, rel),
  FOREIGN KEY (project_id, from_id) REFERENCES items (project_id, id) ON DELETE CASCADE,
  FOREIGN KEY (project_id, to_id)   REFERENCES items (project_id, id) ON DELETE CASCADE
);

CREATE TABLE decision_events (
  project_id UUID NOT NULL, id TEXT NOT NULL, seq BIGINT GENERATED ALWAYS AS IDENTITY,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('created','accepted','rejected','reset','edited','deleted',
                                     'link_added','link_removed','link_confirmed','evidence_updated')),
  from_version INTEGER NOT NULL, to_version INTEGER NOT NULL, note TEXT,
  prev_body JSONB,   -- body before an edit; added by ALTER … IF NOT EXISTS on older DBs
  link JSONB,        -- link_* events: { id, to, rel }; added by ALTER … IF NOT EXISTS (the kind CHECK is dropped and re-added)
  actor TEXT NOT NULL CHECK (actor IN ('human','ai')), at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, item_id) REFERENCES items (project_id, id) ON DELETE CASCADE
);
```

Ids are unique per project (composite keys), so forking a project can copy rows without rewriting ids or links. `seq` keeps AI output order and event order stable (it is not part of the model). Item `node`/`type` are free text validated by the app, so new item types need no migration; the enum `CHECK`s and the singleton list are kept in sync with the code by `schema.test.ts`.

## UI on the model

- **Store choice** — the node page uses Postgres when the project row exists (projectId = UUID), else `LocalRepository` (projectId = decoded slug); see architecture.md.
- **AI actions** — `runAiAction()` (`src/lib/store/ai-action.ts`): POST the route, run the task's adapter, `saveRunOutput` with `toRunInput(run, { node, inputs })`. `inputs` are the items the prompt was built from. Process steps (clarify, probe, follow-ups, free-ask) save the run without drafts; a failed call saves a failed run. A run whose output yields no valid item is reported to the person ("AI 输出没有可用条目") and changes nothing.
- **Upstream context** — what a prompt receives for (node, type): the accepted items once the person has accepted any, otherwise every item they have not rejected (`contextItems`, `src/lib/model/context.ts`). Rejected items never travel downstream; the brief snapshot is rebuilt from the brief, red-line and assumption items (`briefRequestContext`).
- **Old default selections → recommendations** — what the old UI pre-selected is now `aiStance: recommend` with a reason, so "采纳全部推荐" reproduces the old default in one click: the primary persona (candidate personas are `neutral`, so one click does not select every persona), priority jobs, baseline and manage-quadrant stakeholders, high/medium-threat and non-consumption alternatives plus the differentiation hypothesis, high-relevance scenario elements, deep-analysis extremes / hostiles / pain points / insights, priority features (a red-line risk is a `caution`), leap top picks, and the brief once its completeness reaches 70 % (below: `caution`). Design sections, modules and subtasks carry the model's own per-item verdict instead (see above), so "采纳全部推荐" there accepts only what the AI actually recommends.
- **Links by hand** — subtask cards "✎ 编辑依赖" (depends_on between subtasks) and module cards "✎ 编辑关联" (module —implements→ feature): a checkbox per candidate, one `editLinks` call per toggle; candidates that would close a cycle are disabled (`LinkPicker`).
- **Decisions** — every judgeable item has accept / reject-with-note / undo (and an editor for its free-text fields); the note goes into the next regeneration's feedback. Baseline stakeholders cannot be rejected (they were "必选不可删" before). The leap 🔒 lock is gone: "再补 3 条" is additive, so nothing needs protecting.
- **Not items** — derived copilot follow-ups and their answers, the brief draft and the import notice are browser UI state (`td:ui:<projectId>:<key>`, `src/lib/store/ui-cache.ts`). A failed follow-up derivation is remembered there too (`followups-failed:<node>`, keyed by the node's inputs — item ids + versions): revisiting the node shows the failure with a "重试派生" button instead of calling the AI again; it re-derives on its own only once the inputs changed (`planFollowUps`, `src/lib/store/follow-ups-state.ts`).

## How the pre-3a sessionStorage payloads map onto items (historical)

| Key `td:<slug>:…` | Field | Becomes |
|---|---|---|
| `brief` | `raw_text`, `fields` (minus `red_lines`), `highlights` fact/missing, `follow_ups`, `completeness`, `answers`, `follow_up_answers` | `brief` singleton |
| | `fields.red_lines[]` | `red_line` items |
| | `highlights[kind=assumption]` | `assumption` items (`quote` = text, `rationale` = reason) + brief —assumes→ assumption |
| `users` / `users-ui` | `personas[]` + `extraPersonas[]` | `persona` items; `personaLocked[id]` true → accepted, false → rejected |
| | `jobs.{functional,emotional,social}[]` | `job` items (`dimension`); `persona_ids` → Links; `suggested_priority` → aiStance; `jobLocked` → accepted |
| | `priority_summary`, `critiques` | `summary` (priority), `critique` items |
| | `jobsBasedOn`, `addingMore`, `refiningJobs` | UI state; "personas changed since jobs were refined" is derivable from the refine run's `inputs` |
| `stake` / `stake-ui` | `stakeholders[]` (+ `selected`) | `stakeholder` items (selected → accepted) |
| | `engagement_plan`; `priority_summary`; `critiques` | `engagement_plan` singleton; `summary`; `critique` |
| `alt` | `alternatives[]` | `alternative` items |
| | `strategic_profiles[]`, `feature_breakdowns[]` | `alt_profile`, `alt_breakdown` (+ Link to the alternative) |
| | `differentiation_hypothesis` + `key_threats` | `diff_hypothesis` singleton |
| `scen` / `scen-ui` | `dimensions.<dim>[]` (+ `selectedElements`) | `scenario_element` items (`dim`; selected → accepted) |
| | `scenarios[]` (+ `pickedScenarios` / `picked_scenario_ids`) | `scenario` items (picked → accepted) + Links |
| | `deep.matrix`, `extremes`, `hostiles`, `pain_points`, `delight_points`, `design_insights`, `critiques` | `matrix_cell`, `extreme`, `hostile`, `pain_point`, `delight_point`, `insight`, `critique` |
| `feat` | `pillars`, `features` (user priority toggle → accepted), `not_doing`, `differentiation_echo`, `critiques` | `pillar`, `feature`, `not_doing` on node `feat`; `summary`; `critique` |
| `leap` | `analysis.{first_principles,analogies,constraint_flips}` with `states` / `locked` | leap items; selected or locked → accepted, rejected → rejected |
| | `analysis.recommendation` | `top_picks` → aiStance + `required_changes`; timing → `summary` (leap_timing, verdict) |
| `final` (written by revise-features) | `features`, `pillars`, `not_doing` | the same types on node `final` (+ lineage Links to the `feat` originals) |
| | `revision.revisions[]`; `revision.summary`; `differentiation_echo`; `revision.critiques` | `revision` items; `summary` (revision); `summary` (differentiation_echo); `critique` |
| | `source_*`, `selected_leap_ids`, `revised_at` | dropped: derivable from Links, accepted leap items and `run.createdAt` |
| `design` (also `final.design`) | `title`/`one_liner`/`vision`, `design_principles`, `information_architecture`, `user_flows`, `key_interactions`, `data_model`, `tech_skeleton`, `metrics`, `risks`, `milestones`, `open_questions` | `design_section` items (kind overview, principles, ia, flow, interaction, data_entity, tech, metric, risk, milestone, open_question) |
| | `modules` | `module` items + Links |
| `split` | `splits[].subfeatures[]` | `subtask` items (`feature_id`, `module_id` from the split; `dependencies` → Links) |
| | `critical_path`; `summary`; `total_subfeatures` | `subtask.critical`; `summary` (split); derived count |
| `<kind>-followups` | derived follow-up questions | not items (regenerable copilot prompts) |
| cookie `td-done:<slug>` | completed kinds | derived cache of `completedNodes(items)` |

## Migration status

Done in this milestone: Zod 4; the model, planners and both repositories; `schema.sql` on the new tables; `listProjects()` counts nodes from `items`.

Done in milestone 2: the decisions above (`prevBody`, failed runs on empty output, empty-scope protection, hints, `acceptRecommended`, pure-local projectId); every `/api/ai/*` route goes through `runTask()`, which returns run metadata shaped for `Run` (`toRunInput()`), and routes no longer touch the database (the legacy `upsertNode` / `logAiExchange` helpers are gone).

Done in milestone 3a: every node runs on items (`ProjectStoreProvider`, `useNodeData`, `useAiAction`, `useItemActions`); the Postgres mode over `/api/projects/[id]/*`; task adapters and `RegenerationFeedback` in prompts; runs (also failed ones) saved after each AI call; completion cookie written from derived completion; project fork in both modes; export / import of the graph. The `td:<slug>:<kind>` sessionStorage cache, `forkCache` and the legacy `nodes` reader are gone (old values in a browser are simply ignored).

Done in milestone 3b: per-item AI stance from the design and subtask prompts (`stance` → `aiStance`, missing → neutral); `DELETE /api/projects/[id]`; failed copilot follow-up derivations remembered instead of retried on every visit; the streaming pilot on the scenarios node (NDJSON progress, cancel; `docs/architecture.md`); the prompt eval baseline (`evals/README.md`: offline schema / render / promptVersion checks in `pnpm test`, `pnpm eval` for real runs with `--dry-run` budgets).

Done in phase 3: staleness UI with confirm / AI redo and the `revisit` feedback; hand-edited Links (subtask dependencies, module ↔ feature) with link events and cycle checks; `prevBody` on every edit; consistency rules and the manual AI check (`finding` items, exhaustive scopes); PRD and Jira / Linear / GitHub task exports ([exports.md](exports.md)); source checks with `evidence_updated`.

Still to build: blanket stances that remain rule-based rather than model-given (red lines, personas, the differentiation hypothesis, deep-analysis extremes / hostiles / pain points / insights); linking dependencies automatically on import into issue trackers.
