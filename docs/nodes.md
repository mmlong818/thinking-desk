# Node Reference

Each node is defined in `src/data/nodes.ts` and rendered by a component in `src/components/nodes/`. The `deps` field determines which nodes must be completed before this one unlocks.

---

## 01 · Brief (`brief`)

**Section:** Problem Definition  
**Deps:** none  
**Purpose:** Clarify the problem statement through structured AI dialogue. Extracts a clean Brief object (problem, context, constraints, success criteria).  
**Primary AI task:** `BRIEF_EXTRACT`  
**Component:** `BriefNode.tsx`

---

## 02 · Users (`users`)

**Section:** Four-Dimensional Analysis  
**Deps:** `brief`  
**Purpose:** Map user segments using Jobs-to-be-done (JTBD) — functional, emotional, social jobs. Identify underserved clusters.  
**Primary AI task:** `USERS_JTBD`  
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
**Purpose:** Generate use scenarios across 6 dimensions (who, what, when, where, why, how). Feeds the storyboard.  
**Primary AI task:** `SCEN_FEED`  
**Component:** `ScenariosNode.tsx`

---

## 06 · Features (`feat`)

**Section:** Conventional Solution  
**Deps:** `brief`  
**Purpose:** List the features a conventional market solution would have. Intentionally pre-design — benchmark without bias.  
**Primary AI task:** `FEAT_DRAFT`  
**Component:** `FeaturesNode.tsx`

---

## 07 · Creative Leap (`leap`)

**Section:** Start Designing  
**Deps:** `feat`  
**Purpose:** The inflection point. Review the feature list, reject/keep/lock items, and apply creative leaps that differentiate the product. Real design starts here.  
**Primary AI task:** `LEAP_GENERATE`  
**Component:** `LeapNode.tsx`

---

## 08 · Design Proposal (`final`)

**Section:** Start Designing  
**Deps:** `feat`  
**Purpose:** Synthesise upstream work into a full design document — rationale, feature decisions, open questions.  
**Primary AI task:** `GENERATE_DESIGN`  
**Component:** `FinalFeaturesNode.tsx`

---

## 09 · Subfeature Split (`split`)

**Section:** Start Designing  
**Deps:** `final`  
**Purpose:** Break the design proposal into concrete, executable subfeatures/tasks ready for a sprint backlog.  
**Primary AI task:** `SPLIT_SUBFEATURES`  
**Component:** `SplitNode.tsx`

---

## Lock Mechanics

`isNodeLocked(kind, completedSet)` in `data/nodes.ts` returns `true` if any dep is missing from `completedSet`. The SSR page builds `completedSet` from the Postgres DB (if available) or the `td-done:<slug>` cookie. `LockedNode.tsx` renders in place of the real component when locked.
