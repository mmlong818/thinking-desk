# Node Reference

Each node is defined in `src/data/nodes.ts` and rendered by a component in `src/components/nodes/`. The `deps` field determines which nodes must be completed before this one unlocks.

---

## 01 · Brief (`brief`)

**Section:** Problem Definition  
**Deps:** none  
**Purpose:** Clarify the problem statement through structured AI dialogue. Extracts a structured Brief (problem statement, target user, scenario, value proposition, success criteria, time constraint, boundaries, red lines).  
**AI tasks:** `BRIEF_CLARIFY` (decide whether to ask), `BRIEF_PROBE` (one-question interview), `BRIEF_EXTRACT` (primary)  
**Component:** `BriefNode.tsx`

---

## 02 · Users (`users`)

**Section:** Four-Dimensional Analysis  
**Deps:** `brief`  
**Purpose:** Map user segments using Jobs-to-be-done (JTBD) — functional, emotional, social jobs. Identify underserved clusters.  
**AI task:** `USERS_JTBD` (also used for refining jobs and adding personas)  
**Component:** `UsersNode.tsx`

---

## 03 · Stakeholders (`stake`)

**Section:** Four-Dimensional Analysis  
**Deps:** `brief`  
**Purpose:** Plot stakeholders on a Mendelow matrix (power × interest). Surface hidden influencers and blockers.  
**Primary AI task:** `STAKE_MATRIX`  
**Component:** `StakeholdersNode.tsx`

---

## 04 · Alternatives (`alt`)

**Section:** Four-Dimensional Analysis  
**Deps:** `brief`  
**Purpose:** Scan competitive landscape — direct alternatives, indirect alternatives, and non-consumption (doing nothing / workarounds).  
**Primary AI task:** `ALT_SCAN`  
**Component:** `AlternativesNode.tsx`

---

## 05 · Scenarios (`scen`)

**Section:** Four-Dimensional Analysis  
**Deps:** `brief`  
**Purpose:** Exhaust 7 dimensions (time, place, people, trigger, process, tools, conditions), combine selected elements into scenarios, then deep-analyze them (matrix, extremes, hostile cases, pain points). `nodes.ts` labels this node "六维" (six dimensions), but the code defines seven.  
**AI tasks:** `SCEN_FEED` (dimensions and scenarios), `SCEN_PAIN` (deep analysis)  
**Component:** `ScenariosNode.tsx`

---

## 06 · Features (`feat`)

**Section:** Conventional Solution  
**Deps:** `brief`  
**Purpose:** List the features a conventional market solution would have. Intentionally pre-design — benchmark without bias.  
**AI task:** `FEAT_DRAFT`  
**Component:** `FeaturesNode.tsx`

---

## 07 · Creative Leap (`leap`)

**Section:** Start Designing  
**Deps:** `feat`  
**Purpose:** The inflection point. Generate first-principles rethinks, analogy transfers and constraint flips, review them, and feed the chosen leaps back into the feature list. Real design starts here.  
**AI tasks:** `LEAP_FIRST_PRINCIPLES` (primary), `LEAP_ANALOGY` and `LEAP_CONSTRAINT_FLIP` ("more items" requests); revisions of the feature list use `FEAT_DRAFT`  
**Component:** `LeapNode.tsx`

---

## 08 · Design Proposal (`final`)

**Section:** Start Designing  
**Deps:** `feat`  
**Purpose:** Synthesise upstream work into a full design document — rationale, feature decisions, open questions.  
**AI task:** `DESIGN_PROPOSAL`  
**Component:** `FinalFeaturesNode.tsx`

---

## 09 · Subfeature Split (`split`)

**Section:** Start Designing  
**Deps:** `final`  
**Purpose:** Break the design proposal into concrete, executable subfeatures/tasks ready for a sprint backlog.  
**AI task:** `SPLIT_SUBFEATURES`  
**Component:** `SplitNode.tsx`

---

## Lock Mechanics

`isNodeLocked(kind, completedSet)` in `data/nodes.ts` returns `true` if any dep is missing from `completedSet`. The SSR page builds `completedSet` from the Postgres DB (if reachable) and the `td-done:<slug>` cookie (`td-done-h:<hash>` for long slugs). `LockedNode.tsx` renders in place of the real component when locked.
