# Exports

Everything is built in the browser from the project's items and downloaded as a file (top bar → 导出). Nothing is pushed to Jira, Linear, GitHub or any other service. Code: `src/lib/export/` (pure, deterministic: the same items and date give the same file; snapshot tests in `export.test.ts`).

| Menu entry | File | Content |
|---|---|---|
| Markdown | `<project>-<time>.md` | every node's items with ✓ / ✗ / · decisions (the pre-phase-3 digest) |
| JSON | `<project>-<time>.json` | the full graph (`thinking-desk/graph`), re-importable from the home page |
| PRD（Markdown） | `<project>-<time>-PRD.md` | accepted items only, see below |
| 任务单 · Jira CSV | `…-jira.csv` | accepted subtasks |
| 任务单 · Linear CSV | `…-linear.csv` | accepted subtasks |
| 任务单 · GitHub Issues | `…-github-issues.json` | accepted subtasks |

## PRD

`toPrdMarkdown(project, graph, { now })` — only accepted items; pending and rejected ones stay out. Sections: 1 背景与问题 (brief fields, red lines) · 2 用户与 Job · 3 干系人 (+ engagement plan) · 4 替代方案与差异化 · 5 情景与洞察 (scenarios, pain points, insights) · 6 功能 (table sorted by RICE, with Kano, AI priority and core hypothesis; the revised list of node 08 when it has accepted features, else node 06; plus 不做什么) · 7 设计 (overview, principles, IA, flows, interactions, data model, tech, metrics, milestones) · 8 模块 (implemented features and dependencies from their Links) · 9 风险与假设 · 10 待决问题 · 11 一致性发现 (accepted AI findings, the number still pending, and the rule findings).

Every line ends with a provenance tag 〔origin·stance〕: `AI` produced by the AI, `AI·改` produced by the AI and edited by a person, `人` added by a person; `荐 / 中 / 慎` = the AI's stance (recommend / neutral / caution).

## Task files

`taskRows(graph)` normalises the accepted subtasks: keys `T-1…` in dependency order (a subtask always comes after the ones it depends on), title, description, acceptance criteria, layer, estimate, critical path, the feature (`implements` Link, else the feature name it carries) and module (`derived_from` Link), and its dependencies among the exported subtasks. A dependency on a subtask that is not accepted (so not exported) is mentioned as a count. The shared description reads: description · 验收标准 · 功能 / 模块 / 层 / 估时 · 依赖 · 来源 (key, permanent id, critical path).

Labels everywhere: `layer-<layer>`, `critical-path` (critical subtasks), `thinking-desk`.

Files are UTF-8 **without** a byte-order mark (importers read the header row literally). Opening a CSV in Excel by double-click may show garbled Chinese; import it into the tool directly, or use Excel's 数据 → 从文本/CSV with UTF-8.

### Jira Cloud

Columns: `Work item ID, Summary, Description, Work type (Task), Priority (High on the critical path, else Medium), Labels × n, Original Estimate, Blocks × n`.

Import: Jira settings → System → External system import → CSV (or, in a space, "Import work items from a CSV file"); pick the file (UTF-8, comma delimiter), then map the columns: Summary → Summary, Description → Description, Work type → Work type, Priority → Priority, every `Labels` column → Labels, Original Estimate → Original Estimate, Work item ID → Work item ID, and every `Blocks` column → the link type "Blocks". Priorities `High` / `Medium` must exist in your scheme (value mapping step).

Conventions used (checked 2026-10-13 against Atlassian's "Import data from a CSV file" and "Common CSV file questions" pages for Jira Cloud): Summary is the only required column; a multi-value field such as Labels repeats its header, one value per cell; Original Estimate is in **seconds** (estimates are converted with 8 h a day and 5 days a week; an estimate that is not a number with h / d / w — e.g. `2-3d` — is left empty and stays readable in the description); cells with commas or line breaks are quoted.

Dependencies: "A depends on B" is written as B blocks A — row B's `Blocks` columns hold the Work item IDs of the rows it blocks. **Not verified for Jira Cloud:** the link-column procedure is documented in an Atlassian knowledge-base article for Jira Data Center (the same wizard is said to apply to Cloud), and whether Cloud resolves in-file Work item IDs in a link column is not shown there. Try a small import first; if links do not come through, the dependencies are also in each description (`依赖：T-1 …`).

### Linear

Linear has no generic CSV importer; it imports CSVs in the formats it knows. The file uses **Linear's own CSV format** (checked 2026-10-13 against linear.app/docs "Import issues" / "CLI importer" and the `@linear/import` README): `Title, Description, Priority, Status, Assignee, Created, Completed, Labels, Estimate`; labels are one cell, comma-separated.

Import (as a workspace admin): `pnpm dlx @linear/import` (or `npx @linear/import`) → choose the "Linear" CSV option → pick the file and the team. Re-importing into the same team skips issues it already imported.

Left empty on purpose: Priority, Status, Assignee, Created, Completed, Estimate — the accepted values of Priority and Estimate are not documented (Estimate also depends on the team's estimate scale). Not expressible: Linear's CSV formats have no parent / relation columns, so dependencies stay in the description (`依赖：T-1 …`).

### GitHub Issues

`{ format: "thinking-desk/github-issues", version: 1, labels: [{ name, color, description }], issues: [{ key, source_id, depends_on, title, body, labels }] }` — issues in dependency order; `title` / `body` / `labels` are exactly the payload of the REST "create an issue" endpoint.

Import with the GitHub CLI (`gh`, logged in) and `jq`:

```bash
REPO=owner/name
FILE=学习陪练-2026-10-13T08-00-github-issues.json

# 1. labels (idempotent: --force updates an existing one)
jq -r '.labels[] | [.name, .color, .description] | @tsv' "$FILE" |
  while IFS=$'\t' read -r name color desc; do
    gh label create "$name" --color "$color" --description "$desc" --force -R "$REPO"
  done

# 2. issues, in dependency order; prints "<key> → #<number>"
jq -c '.issues[]' "$FILE" |
  while IFS= read -r issue; do
    num=$(printf '%s' "$issue" | jq '{title, body, labels}' | gh api "repos/$REPO/issues" --input - --jq '.number')
    printf '%s → #%s\n' "$(printf '%s' "$issue" | jq -r .key)" "$num"
    sleep 1   # GitHub's secondary rate limits apply to bursts of content creation
  done
```

Verified 2026-10-13 against the GitHub CLI manual (`gh label create`, `gh issue create`) and the REST docs ("Create an issue"; issue dependencies and sub-issues are GA). Not done automatically: linking the "blocked by" dependencies. With a recent `gh`, `gh issue create --blocked-by <number>` can set them, and the REST endpoint `POST /repos/{owner}/{repo}/issues/{number}/dependencies/blocked_by` takes the blocking issue's database `id` (not its number); the export keeps `depends_on` keys and the body text (`依赖：T-1 …`) so a follow-up script can map keys to the numbers printed above. Whether `gh api --jq` needs an external `jq` was not verified; the loop above needs `jq` anyway.
