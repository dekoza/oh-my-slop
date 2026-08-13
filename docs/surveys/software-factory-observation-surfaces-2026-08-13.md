# Survey: Software Factory observation surfaces (2026-08-13)

Research for Gitea `minder/oh-my-slop#68`, a decision ticket under wayfinder map #67 (read-only,
repository-scoped Software Factory monitor). Blocks #69 (run/event model), #70 (tracker-graph
reconstruction), #72 (service/streaming architecture), #73 (retention/transcripts).

**Question:** which trustworthy state and output can a monitor obtain from the scheduler, run store,
Gitea, Herdr, git, and the pi extension host during and after a run; what are those sources' APIs and
lifetimes; and which observation seams must the specification introduce?

**Method:** full read of `extensions/software-factory/` (1720 lines across `index.ts` and `lib/`),
`tests/node/software_factory_*.test.mjs`, the installed pi SDK type definitions and docs at
`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/`, the global `herdr` skill, plus
read-only inspection of the live run store, the live git worktrees, and read-only `tea api` calls
against the live Gitea instance. Nothing was run, started, or written.

**Headline:** the factory is *observable by accident, not by design* — but the two systems it sits
between are far more observable than it is, and it uses neither of their observation surfaces.

The factory's own output is thin: the scheduler emits **no events at all**, the run store is a
**single overwritten JSON document with no timestamps and no history**, and during the single
longest phase of a run — one worker prompt, default budget **7 200 000 ms / 2 h**
(`lib/herdr.mjs:235`), consumed through a non-streaming `pi.exec` — *nothing anywhere is written by
the factory*. A monitor built only on the factory's surfaces would show a run frozen at
`running #64` for two hours and could not tell that from a crash. The live store proves the point: a
run marked `"status": "running"` is owned by pid 3852874, which is dead, and its stale lock will
refuse the next `/factory start` with no documented recovery.

Meanwhile: **Herdr has a real push event stream** — 26 event kinds over its Unix socket, verified at
86 frames in 8 seconds, including agent-status transitions and server-side output matching — which
is not exposed by the `herdr` CLI, is not mentioned in the global `herdr` skill, and is not used by
the factory. And **Gitea has a per-issue `timeline` endpoint with `since` support** that records
label, assignee, dependency, close and title events as an append-only stream, from which an entire
factory run on ticket #64 can be reconstructed after the fact — also unused. The gap the
specification has to close is therefore less "invent observability from nothing" and more "make the
scheduler say what it already knows, and join it to two streams that already exist."

The one thing genuinely absent everywhere is a **completion/failure signal**: Herdr exposes no exit
code for any pane (`exit_code` occurs once in its entire API schema, on plugin logs), which is
precisely why the factory has to scrape a `FACTORY_RESULT` sentinel line out of ~45 visible terminal
rows.

---

## Placement of the deliverable

Placed in `docs/surveys/` alongside `open-mercato-skills-adoption-2026-08-12.md` and
`mattpocock-skills-sync-2026-08-05.md`, matching the existing convention (dated slug, citation-dense,
opinionated).

---

## 0. The system under observation

`/factory start <ticket-or-parent>` runs entirely inside **one pi process, in one Herdr pane**
(`extensions/software-factory/index.ts:49`, `lib/herdr.mjs:147-150` requires `HERDR_ENV=1`). It is a
serial scheduler: `herdr.maxWorkers` is hard-pinned to `1` (`lib/config.mjs:209-211`).

Loop shape, from `lib/factory.mjs:75-320`:

```
preflight → listFrontier → (empty? → nothing-to-do | waiting-for-human | final review → publish → PR)
         → createRun (integration worktree + branch) → createWorkspace (Herdr)
         → per ticket: claim → createTicket worktree → createWorker → promptWorker
                     → verifyTicket → createWorker(review) → promptReviewer → verifyReviewState
                     → integrate → verifyIntegration → retireWorker → cleanupTicket → complete
```

Terminal `state.status` values, all set in `lib/factory.mjs`: `starting` (:35), `running` (:71),
`nothing-to-do` / `waiting-for-human` (:53-55, :81, :119, :298, :311), `automation-failed` (:275),
`awaiting-merge` (:129), `failed` (:322).

Every model-bearing phase is a *separate* agent process started by Herdr in its own tab
(`lib/herdr.mjs:207-229`); the scheduler talks to them only by one blocking `herdr agent prompt
--wait` per phase (`lib/herdr.mjs:236-240`) and one `herdr agent read` afterwards (:247-251).

---

## 1. Scheduler (the `runFactory` loop, in-process)

### What it exposes

The scheduler's entire externally visible output is (a) the mutable `state` object it hands to
`store.save()`, (b) four `ctx.ui` calls, and (c) side effects on git/Gitea/Herdr. It has **no event
emitter, no callback parameter, no log**.

`state` field-by-field (`lib/factory.mjs:31-44`):

| Field | Set at | Notes |
|---|---|---|
| `id` | `:32` | `factory-YYYYMMDD-<6 hex>` from `index.ts:21-24` — **date only, no time** |
| `cwd` | `:33` | absolute repo path; the only repository scoping in the run document |
| `parentIndex` | `:34` | the `/factory start` argument; may be a parent *or* a single ticket |
| `status` | `:35` | see §0 |
| `integrationBranch` / `integrationPath` | `:68-69` | undefined until `git.createRun()` succeeds |
| `workspaceId` | `:70` | Herdr workspace id, e.g. `"w17"` — the **only** Herdr handle persisted |
| `currentTicket` | `:136`, cleared `:274`/`:284`/`:297`/`:310`/`:318` | integer index, no title |
| `completed` / `blocked` / `automationFailed` | `:39-41`, pushed `:317`/`:284`/`:273` | **arrays of bare integers** |
| `finalReview` | `:106`, `:116` | `{status, summary, findings[]?, reason?, profile}` |
| `pullRequest` | `:127` | URL string |
| `error` | `:276`, `:323` | free text, only on `automation-failed` / `failed` |

### How you get it

Only via `store.save(state)` (`lib/factory.mjs:45`), which `index.ts:106-111` wraps to also call
`ctx.ui.setStatus("software-factory", …)`. `save()` fires at: run start (`:49`), the empty-frontier
terminals (`:54`, `:82`), after workspace creation (`:72`), on each ticket pick (`:137`), on each
block (`:286`), on each completion (`:319`), on the integration/cleanup failures (`:299`, `:312`),
on automation failure (`:277`), and in the outer `catch` (`:324`). That is **at most ~5 writes per
ticket**, all at phase boundaries.

### Push or pull

Neither, from outside the process. `store.save` is a plain `await` on a file write; a monitor in the
same process could wrap it (it is injected, `index.ts:127`), but a monitor in another process must
poll or `fs.watch` the run file (§2). There is no `pi.events` emission anywhere in the extension —
`grep` over `extensions/software-factory/` finds no use of the `pi.events` EventBus
(`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/event-bus.d.ts:1-4`).

### Lifetime and trustworthiness

The scheduler state is **authoritative while the process lives and nowhere else**. `activeRuns` is a
`Map<cwd, Promise>` on the extension closure (`index.ts:46`): it dies with the pi process, is not
consulted by `/factory status`, and is not shared between two pi panes. The file lock
(`lib/store.mjs:30-49`) is the only cross-process guard.

Nothing in the loop is idempotent or resumable. The README is explicit: "The MVP does **not** resume
an interrupted scheduler after the controlling pi process exits" (`README.md:221-222`). So on crash,
`state.status` freezes at whatever it last was — usually `running`.

### During-run vs after-run

During: the in-memory `state` is complete and correct; the persisted copy lags by up to one whole
worker phase. After: the in-memory state is gone; only the persisted snapshot survives.

### Findings

- **No per-ticket outcome detail is retained.** `completed`/`blocked`/`automationFailed` are
  integers. The blocking `reason` (`lib/factory.mjs:283`), the worker profile
  (`result.workerProfile`, `:200`), the test evidence (`result.tests`), and the per-ticket review
  verdict (`result.review`, `:216`) are all passed to `tracker.complete()`/`tracker.block()` and
  then **dropped**. Only `finalReview` survives in the run document.
- **No Herdr tab or pane ids are persisted.** `createWorker` returns `{name, tabId, paneId}`
  (`lib/herdr.mjs:228`) and the scheduler keeps them in loop-local variables only. `workspaceId` is
  the sole persisted handle.
- **Worker names are recoverable but only by re-deriving them.** `workerName()`
  (`lib/factory.mjs:4-7`) is pure: `sf-<last-16-of-runId-sans-"factory-">-t<index>[-v<n>|-r<n>]`,
  truncated to 32 chars. A monitor can reconstruct candidate names, but not know which ones existed.
- **The repair/retry structure is invisible.** The `attempt` counter (`:190`), `reviewNumber`
  (`:157`), and `retry` counter (`:229`) never leave the loop. A ticket that took one repair plus one
  fresh worker looks identical, in every durable surface, to one that succeeded first try — except
  in Herdr tab labels and pi session directories.

---

## 2. Run store (`lib/store.mjs`, on disk)

### What it exposes

Three artifacts under `${PI_AGENT_DIR:-~/.pi/agent}/software-factory/` (`index.ts:47`):

| Path | Content | Writer |
|---|---|---|
| `runs/<runId>.json` | the whole `state` document, pretty-printed | `store.save()` (`store.mjs:25-26`) |
| `active/<sha256(cwd)[0:20]>.json` | `{"id": "<runId>"}` pointer | `store.save()` (`store.mjs:27`) |
| `active/<sha256(cwd)[0:20]>.lock` | `{"runId":…,"pid":…}` | `store.acquire()` (`store.mjs:33-37`) |

Live contents at time of writing, confirming the shapes (`~/.pi/agent/software-factory/`, mode
`0700` dirs / `0600` files per `store.mjs:11,23,31,33`):

```
runs/factory-20260813-77a2fa.json   {"id","cwd","parentIndex","status":"running","integrationBranch",
                                     "integrationPath","workspaceId":"w17","currentTicket":609,
                                     "completed":[],"blocked":[]}
active/8f2eb9c4eb678f57f660.json    {"id":"factory-20260813-77a2fa"}
active/8f2eb9c4eb678f57f660.lock    {"runId":"factory-20260813-77a2fa","pid":3852874}
```

`sha256("/home/minder/projekty/nukem2_again")[0:20] == 8f2eb9c4eb678f57f660` and
`sha256("/home/minder/projekty/oh-my-slop")[0:20] == e1aa56aa383a9ea1aeee`, confirming
`repositoryKey()` (`store.mjs:5-7`).

### How you get it

`store.loadActive()` (`store.mjs:65-73`) reads the pointer, then the run file. `/factory status`
formats it through `formatStatus()` (`index.ts:26-43`) and prints it as a notification
(`index.ts:57-60`). Externally: read the JSON directly. Writes are atomic — temp file plus `rename`
(`store.mjs:9-13`) — so a poller can never see a torn document, but will see transient
`<name>.<pid>.<uuid>.tmp` siblings in the directory.

### Push or pull

Pull, or `fs.watch` on `runs/`. Because the write is a rename, a watcher gets a clean `rename` event
per save. Cost is negligible (files are 169–632 bytes). But the *rate* is the problem, not the cost:
see §1 — one write per phase boundary, none during a two-hour worker phase.

### Lifetime and trustworthiness

- **Durable across controller restart** — `/factory status` genuinely survives a reload
  (`README.md:213-215`), and this is the only claim of durability the factory makes that holds.
- **Never rotated, never deleted.** No code path removes anything from `runs/`. Ten files have
  accumulated in one day of use.
- **Not repository-scoped.** `runs/` is a *flat, global* directory: runs for `oh-my-slop` and
  `nukem2_again` sit side by side, and the run id encodes only a date. The only way to scope a
  monitor to one repository is to read every file and filter on `state.cwd`, or to follow the
  per-repo `active/` pointer — which points at exactly **one** run, so history for a repository is
  not reachable through the pointer at all. **`README.md:64` calling `/factory status` "the last
  repository-scoped run snapshot" overstates what the store provides**: only the *pointer* is
  repository-scoped.
- **No timestamps whatsoever.** Neither the state document nor the run id carries a start time, an
  end time, or per-phase times. `createRunId()` uses `toISOString().slice(0,10)` — date only
  (`index.ts:22`). The only temporal signal is the file's `mtime`, which is the time of the *last*
  save, i.e. usually the terminal transition. Ordering of runs within a day is unrecoverable from
  the document.
- **Human-mutable, and demonstrably mutated.** The files are plain JSON owned by the user. The live
  store contains `factory-20260813-7325b7.json` whose `error` reads "Run reclassified after
  confirming that Herdr 0.8.0 raw agent-read output was incorrectly parsed as JSON…", which no code
  path in `lib/factory.mjs` can produce (compare the generated text at `:270`). The run store has
  already been hand-edited in practice. A monitor must treat it as a *claim*, not a fact.
- **Stale locks are never reclaimed.** `store.release()` runs from the promise `.finally()`
  (`index.ts:135-143`); a killed process never reaches it. The live store contains exactly this:
  `8f2eb9c4eb678f57f660.lock` naming pid 3852874, which `ps -p 3852874` reports as not running,
  while the run document still says `"status": "running"`. Consequences: (a) `/factory status`
  reports a dead run as live forever, (b) the next `/factory start` in that repo fails with "This
  repository is already locked by factory-20260813-77a2fa" (`store.mjs:47`) and the README's
  recovery section (`README.md:211-225`) never mentions deleting the lock file. The pid *is*
  recorded, so liveness is checkable — but nothing checks it.
- **Schema drift is already present.** Older run files lack `automationFailed` entirely (undefined
  fields are dropped by `JSON.stringify`), and `formatStatus()` guards for that (`index.ts:29`).
  There is no `version` field on the run document.

### During-run vs after-run

During: coarse, laggy, but live. After: the *only* first-party record of the run, and it is a single
final-state snapshot — the run's trajectory is not recorded anywhere in it.

---

## 3. Gitea (the tracker)

Live instance: Gitea **1.27.0** (`tea api version` → `{"version":"1.27.0"}`), `tea` CLI 0.15.1, repo
`minder/oh-my-slop` (`repo.id` 18). All probes below were read-only GETs. Credentials live at
`~/.config/tea/config.yml` and `~/.config/tea/credentials.json.enc`; values were neither read nor
recorded.

### 3.1 What the factory writes to it (so, what a monitor can read back)

| Write | Command | Site |
|---|---|---|
| Claim | `tea issues edit <n> --repo … --add-assignees <assignee>` | `lib/gitea.mjs:127-131` |
| Complete | marker comment + `tea issues close <n> --repo …` | `lib/gitea.mjs:164-178` |
| Automation failure | marker comment + `−ready-for-human +ready-for-agent −assignee` | `lib/gitea.mjs:180-189` |
| Human blocker | marker comment + `−ready-for-agent +ready-for-human −assignee` | `lib/gitea.mjs:191-200` |
| Run report | marker comment on the **parent** issue, `🤖 \`software-factory\` — run <runId>` | `lib/gitea.mjs:214-230` |
| PR | `tea pulls create --repo … --head --base --title --description` | `lib/gitea.mjs:202-212` |

Marker convention (`docs/agents/issue-tracker.md:44-58`): every robot comment opens with
`` 🤖 `<skill-name>` — <purpose> ``, and re-runs **edit the marker comment in place** rather than
posting again (`upsertComment`, `lib/gitea.mjs:134-158`, matching with `body.startsWith(marker)` at
`:145`). Live confirmation: issue #64 carries eight comments, all `🤖 \`software-factory\` — …`,
with purposes `run <run-id>`, `human blocker`, `ticket integration`, `automation failure`.

**`reportRun` is the only place the run id ever reaches the tracker**, and it fires only at terminal
states (`lib/factory.mjs:57,83,121,131,278,300,313,327`). Per-ticket comments carry the integration
branch but not the run id (`lib/gitea.mjs:170`).

### 3.2 Field inventory (confirmed live)

**`tea api repos/minder/oh-my-slop/issues/67`** — 3 755 B, 28 top-level fields:
`id` (global DB id, ≠ `number`), `url`, `html_url`, `number`, `user`, `original_author`,
`original_author_id`, `title`, `body`, `ref`, `assets`, `labels[]` (`{id,name,exclusive,is_archived,
color,description,url}`), `milestone`, `projects`, `assignee`, `assignees`, `state`, `is_locked`,
`comments` (count), `created_at`, `updated_at`, `closed_at`, `due_date`, `time_estimate`,
`pull_request` (non-null discriminates PRs, which share the index space), `repository`, `pin_order`,
`content_version`.

Three gotchas worth pinning:

- **`assignees` is `null`, not `[]`, when unassigned.** `hasAssignees()` (`lib/gitea.mjs:21-25`)
  handles this; a monitor must too.
- **Timestamps are RFC3339 with the server's local offset** (`"2026-08-13T10:36:42+02:00"`), not UTC.
- **`content_version` is a body-edit counter** and is the cheapest edit detector available. Live
  spread: `#46 → 9`, `#34 → 9`, `#61 → 2`, `#67 → 1`, `#68 → 0`.

Embedded user objects carry 23 fields but are **inconsistent between contexts**: user id 1 appears
as `issue.user` with `email: dominik@kozaczko.info`, `is_admin: true`, `active: true`, and as
`issue.assignees[0]` with `email: "1+minder@noreply.localhost"`, `is_admin: false`, `active: false`,
`last_login: "0001-01-01T00:00:00Z"`. Key on `id`/`login` only.

### 3.3 The dependency graph

Two endpoints, both HTTP 200, each returning an **array of complete 28-field issue objects** (not
references):

- `repos/{o}/{r}/issues/{n}/dependencies` → issues that block `{n}`
- `repos/{o}/{r}/issues/{n}/blocks` → issues that `{n}` blocks

The live map-#67 graph:

| Issue | blocked by | blocks |
|---|---|---|
| 67 (map) | — | — |
| 68 | — | 69, 70, 72, 73 |
| 69 | 68 | 72, 73, 74 |
| 70 | 68 | 74 |
| 71 | — | 74 |
| 72 | 68, 69 | 74 |
| 73 | 68, 69 | 74 |

**The map itself is outside the dependency graph.** Membership is body text only (`Part of #67`),
exactly as `docs/agents/issue-tracker.md:89-108` describes and as `referencesParent()` implements
(`lib/gitea.mjs:27-34`). Reconstructing the tree (#70) therefore needs both mechanisms — see §9.11.

Cost: `blocks` on #68 is **7 264 B to convey four integers**. There is no bulk dependency endpoint,
so a 7-ticket map costs 7–14 calls and ~40 KB from cold.

### 3.4 The timeline — the tracker's real event stream

`repos/{o}/{r}/issues/{n}/timeline` exists on 1.27.0, returns HTTP 200, and is a strict superset of
`/comments`. It is the single most valuable Gitea surface for this monitor and the factory does not
use it.

Event `type` values observed live: `comment`, `label`, `assignees`, `add_dependency`, `issue_ref`,
`close`, `change_title`. Payload per type:

| `type` | Carries | Add/remove encoding |
|---|---|---|
| `comment` | `body` (full markdown), `created_at`, `updated_at` | — |
| `label` | `label:{id,name,color,…}` | **`body: "1"` = added; absent/empty = removed** — undocumented |
| `assignees` | `assignee` (user) | `removed_assignee: true` = removed; absent = added |
| `add_dependency` | `dependent_issue` (full issue object) | `remove_dependency` exists; none occurred here |
| `issue_ref` | `ref_issue` | fires when another issue's body cites this one |
| `change_title` | `old_title`, `new_title` | full before/after |
| `close` | user + timestamp only | `reopen` is the counterpart |

A complete software-factory run, reconstructed *purely* from `issues/64/timeline` (24 events):

```
01:32:32 assignees    assignee=minder                              <- factory claims
01:32:42 comment      "🤖 software-factory — human blocker"
01:32:42 label        ready-for-agent  (removed)
01:32:42 label        ready-for-human  (body="1", added)
01:32:42 assignees    minder, removed_assignee=true                 <- factory releases
02:13:38 label        ready-for-agent removed / ready-for-human added
02:21:24 label        ready-for-human removed / ready-for-agent added   <- human re-arms
```

**`?since=` works on the timeline and is `updated_at`-based**, so polling is incremental *and* picks
up edits to old entries:
`tea api "repos/minder/oh-my-slop/issues/64/timeline?since=2026-08-13T02:00:00%2B02:00"` returned
`X-Total-Count: 7` / 10 456 B versus 52 799 B for the full timeline, and *included* event 12133
whose `created_at` (01:32:42) predates the cutoff but whose `updated_at` (02:13:38) does not.
Timeline event ids share one sequence with comment ids.

### 3.5 Repo-wide cheap pollers

- `repos/{o}/{r}/issues?state=all&type=issues&limit=50&since=…` — `since` is `updated_at`-based;
  confirmed by `#64` (created 2026-08-05) appearing under `since=2026-08-13T00:00:00Z`. No
  `until`/`before`. `limit` is server-capped at 50.
- `repos/{o}/{r}/issues/comments?since=…` — **repo-wide comments in one call**, same 11-field comment
  schema plus `issue_url`. 2 243 B / 45 ms for a day's worth. This is the cheapest way to watch every
  robot marker comment in the repository.
- `repos/{o}/{r}/activities/feeds?limit=50[&date=YYYY-MM-DD]` — exists (does not 404).
  `op_type` histogram over all 233 activities: `comment_issue` 91, `create_issue` 73, `close_issue`
  44, `commit_repo` 22, `close_pull_request` 1, `create_pull_request` 1, `create_repo` 1. **No label,
  assignee, dependency, or title op_types** — strictly coarser than the timeline.

  Its one unique value: `activity.content` is a **frozen snapshot of the comment body at action
  time** (format `<issue-number>|<text>`), while the joined `activity.comment.body` is live.
  Comparing the two is the only server-side way to detect that a comment was edited after the fact.

Pagination: `X-Total-Count` on every list endpoint; `Link` (`rel="next"`/`rel="last"`) only when
more than one page exists. Both are on **stderr** when using `tea api -i`.

### 3.6 Push or pull — strictly pull

There is no token-authenticated stream. Gitea's SSE route `/user/events` authenticates by **web
session cookie**, not API token: probed with `timeout 4 tea api "http://192.168.129.37:30008/user/events"`
→ `event: close` / `data: unauthorized`.

- **Webhooks** are the only genuine push. `repos/minder/oh-my-slop/hooks` returns HTTP 200 and `[]` —
  readable, no 403, none configured. Registering one is a POST (a tracker write) and needs a
  reachable endpoint on the monitor's side.
- **Notifications** (`/notifications`, `?since=` supported) are pull, require a subscription (issue
  #67 has zero subscribers), and marking read is a write.

Recommended pull ladder, cheapest first: (1) `issues?since=` to learn which issues moved, (2)
`issues/comments?since=` for all marker comments, (3) per-issue `timeline?since=` only for issues
step 1 flagged, (4) `dependencies`/`blocks` only when a timeline shows `add_dependency` — those two
have no `since` filter. Use `updated_at` as the cursor with a few seconds of overlap; all `since`
filters are `updated_at`-based, so overlap costs duplicates, never gaps.

### 3.7 Cost

No rate limiting in evidence: the complete response header set across every capture was
`Access-Control-Expose-Headers, Cache-Control, Content-Length, Content-Type, Date, Link,
X-Content-Type-Options, X-Frame-Options, X-Total-Count` — **no `X-RateLimit-*`, no `ETag`, no
`Last-Modified`**, so conditional GETs save nothing. Timings are wall-clock for the whole `tea`
invocation on LAN, best of 3; subtract ~25 ms of process startup (`tea --version` alone is 20–28 ms):

| Call | Avg | Payload |
|---|---|---|
| `issues/67` | 51 ms | 3 755 B |
| `issues/68/blocks` | 105 ms | 7 264 B |
| `issues/64/timeline` | 80 ms | 52 799 B (24 events) |
| `issues/64/timeline?since=…` | 52 ms | 10 456 B (7 events) |
| `labels?limit=100` | 43 ms | 4 571 B (20 labels) |
| `issues?state=all&type=issues&limit=50` | 215 ms | **238 944 B** |
| `issues?…&since=2026-08-13T00:00:00Z` | 84 ms | 21 442 B (9 issues) |
| `activities/feeds?limit=50` | 156 ms | **226 241 B** |
| `issues/comments?since=…` | 45 ms | 2 243 B |

Payloads are grossly inflated by embedding — ~4.8 KB per issue in a list, and a full repo object per
activity entry. `since` is worth roughly 10× on both bytes and latency. A 5-second poll of the two
cheap `since` endpoints costs ~24 KB/min and ~130 ms per cycle; the expense is fanning out to
per-issue timelines and dependency pairs (~15 calls / ~100 KB to rebuild map #67 from cold).

### 3.8 Lifetime and trustworthiness

| Datum | Human-mutable? | Trustworthy? |
|---|---|---|
| `created_at`, `updated_at`, `closed_at` | no (server-set) | yes — but `updated_at` says *something* changed, not what |
| `state`, label set, assignees | yes | yes, and every transition is an append-only timeline event |
| `title` | yes | changes recorded as `change_title` with `old_title`/`new_title` |
| `body` | yes | **no diff recorded** — only `content_version` increments |
| `comment.body` | **yes, silently** | no API revision history; only `activity.content` holds the original |
| `comment.updated_at` | server-set on edit | cannot distinguish an agent's idempotent marker rewrite from a human edit |
| Comment deletion | yes | **removes it from `/comments` *and* `/timeline`** — a deleted robot marker leaves no trace |
| Timeline `label`/`assignees`/`add_dependency`/`close` events | not editable via UI | effectively append-only |

So: **the timeline is append-only for state events but not for comment text.** Comment `12133` on
#64 was created 01:32:42 and updated 02:13:38 — that is `upsertComment()` rewriting its own marker,
indistinguishable from a human edit. A monitor wanting a tamper-evident record of what an agent said
must snapshot bodies itself or read `activities/feeds[].content`.

Zero of 233 activities had a non-zero `comment_id` with a null `comment`, so deletion behaviour in
the activity feed is **untested here and must not be assumed**.

### 3.9 Label taxonomy

20 labels live (`tea api "repos/minder/oh-my-slop/labels?limit=100"`), all `exclusive: false`:
state (`needs-triage` 117, `needs-info` 118, `ready-for-agent` 68, `ready-for-human` 116,
`wontfix` 119), category (`bug` 115, `enhancement` 114), workflow (`workflow:implement` 67),
wayfinder (`wayfinder:map` 46, `:research` 47, `:prototype` 48, `:grilling` 49, `:task` 50), factory
routing (`factory:claude` 151, `factory:gpt` 152, `factory:glm` 153, `factory:deepseek` 154,
`factory:qwen` 155, `factory:local` 156) and `risk:high` 157.

**The `factory:*` and `risk:*` namespaces exist live and are load-bearing for worker routing
(`.pi/factory.json:76-157`, consumed by `lib/routing.mjs:1-9`) but are absent from
`docs/agents/triage-labels.md`.** A monitor keying on the documented taxonomy would not know they
mean anything. Milestones are unused (`milestones?state=all` → `[]`, `X-Total-Count: 0`); wayfinder
maps play that role.

### 3.10 During-run vs after-run

Gitea is the **strongest after-run source in the system** and the weakest live one. During a run it
receives exactly one write at ticket claim (`lib/gitea.mjs:127-131`) and then nothing until the
ticket terminates — for a two-hour worker phase, the tracker is as dark as the run store. After the
run, it holds the only structured, timestamped, cross-restart record of what happened to each
ticket, and (via the timeline) of what a human did afterwards.

---

## 4. Herdr (agent panes)

Live: Herdr **0.8.0**, protocol **19**, `/usr/bin/herdr` from pacman `herdr-bin 0.8.0-2`. Control
socket at `$HERDR_SOCKET_PATH` = `~/.config/herdr/herdr.sock` (mode `0600`, owner-only). Config dir
also holds `session.json`, `herdr-server.log`, `config.toml`.

### 4.1 What the factory uses — five commands, none of them observational

Everything goes through one `exec("herdr", args)` call site (`lib/herdr.mjs:153`):

| Command | Site | Output handling |
|---|---|---|
| `workspace create --cwd … --label <runId> --no-focus` | `:196-201` | JSON; takes `.result.workspace.workspace_id` (`:202`) |
| `tab create --workspace … --cwd … --label "#N title" --no-focus` | `:208-214` | JSON; takes `.result.tab.tab_id` (`:215`) and `.result.root_pane.pane_id` (`:216`) |
| `agent start <name> --kind … --pane … --timeout … [-- <native args>]` | `:221-227` | JSON parsed then **discarded** — the returned agent record is never read |
| `agent prompt <name> <text> --wait --timeout <ms>` | `:236-240` | JSON; a **recursive** `findString` (`:16-26`) hunts anywhere in the payload for `agent_status`/`status == "blocked"` (`:241`) |
| `agent read <name> --source recent-unwrapped --lines 240` | `:247-251` | **raw stdout, not JSON** (uses `execute`, not `run`); empty throws (`:252-254`) |
| `tab close <tabId>` | `:232` | JSON, discarded |

The result channel is a **screen-scrape**: `parseFactoryResult`/`parseReviewResult`
(`lib/herdr.mjs:67-131`) regex that text dump for the *last* `^FACTORY_RESULT {json}$` /
`^FACTORY_REVIEW {json}$` line, with last-match-wins pinned by
`tests/node/software_factory_herdr.test.mjs:30-42`.

**The factory uses none of Herdr's observation surface** — no `agent list`, `agent get`, `pane list`,
`pane read`, `api snapshot`, and no events. Write → block up to 2 h → read once.

### 4.2 What Herdr actually exposes

**Enumeration.** `herdr api snapshot` returns workspaces, tabs, panes, agents, layouts and focused
ids in one call; `workspace|tab|pane|agent list`/`get` do it piecemeal. Ids are opaque and
workspace-qualified (`w18`, `w18:t2`, `w18:p2`), **stable across a server restart** (persisted in
`session.json` v3) and **never reused after close** (`~/.claude/skills/herdr/SKILL.md:68`). Two
caveats: a pane moved to another workspace gets a *new* id, and the live agent **name** is transient
— it follows the pane occupant and is cleared on exit/release/replace (`SKILL.md:56`).

**Run correlation already works, by accident of the labels the factory sets.** A live snapshot shows
workspace label `factory-20260813-77a2fa` (the runId, from `lib/factory.mjs:70`), tab label
`#609 AR screen „Skaner plakatów"… (retry 1)` (from `lib/factory.mjs:236` via `lib/herdr.mjs:213`),
and agent name `sf-20260813-77a2fa-t609-r1` (from `lib/factory.mjs:4-7`). Each pane additionally
carries `terminal_title`/`terminal_title_stripped` (the agent's own OSC title) and a `tokens` map —
up to 32 arbitrary `NAME=VALUE` pairs with optional TTL, settable via `pane report-metadata` /
`workspace report-metadata`. That token map is a purpose-built correlation side-channel that nothing
currently uses.

**Capture.** `pane read` / `agent read` with sources `visible`, `recent`, `recent-unwrapped`,
`detection`, plus `--lines N` and `--format text|ansi`. Retention is an **in-memory ring buffer,
10 MB per pane** (`scrollback_limit_bytes = 10000000`, confirmed in `herdr-server.log`:
`pane_scrollback_limit_bytes=10000000`).

**That 10 MB is a fiction for agent panes.** Claude Code and pi TUIs run on the alternate screen, so
rows that scroll off never enter Herdr's buffer. Measured live: every Claude pane reports
`scroll.max_offset_from_bottom = 0`; reading a Claude pane with `--lines 5000` returns the same
~45 lines / 4 576 bytes as `--lines 50`. Only the non-TUI pi pane had real history (659 rows). This
is documented at `SKILL.md:183`.

> **The factory's `agent read --source recent-unwrapped --lines 240` (`lib/herdr.mjs:247-251`)
> therefore gets roughly 45 lines, not 240**, for Claude-kind workers. `parseFactoryResult` requires
> the sentinel to be inside that window — which is exactly why the worker prompt demands "exactly one
> single-line result and no text after it" (`lib/herdr.mjs:38-42`). This is a hard ceiling on any
> monitor that plans to show transcript excerpts from Herdr's buffer.

**Events — a real push stream that the CLI does not expose.** The socket speaks newline-delimited
JSON and supports `events.subscribe` (streaming; the server pushes indefinitely) and `events.wait`
(one-shot with `match_event` + `timeout_ms`). 26 event kinds / 27 selectors, filterable per
`pane_id`, including `pane_agent_status_changed`, `pane_output_changed` (with `min_revision`),
`pane_exited`, `pane_agent_detected`, `pane_created/closed/moved`, `tab_*`, `workspace_*`,
`worktree_*`, `layout_updated`. `pane.output_matched` takes a substring or regex plus a read source
and line count, so the **server** does the matching.

Verified end to end against the live socket: `ping` → `{"type":"pong","version":"0.8.0",
"protocol":19,"capabilities":{"live_handoff":true,"detached_server_daemon":true}}`, and an
`events.subscribe` on `pane.updated` + `layout.updated` + `pane.agent_status_changed` +
`pane.output_matched` returned `subscription_started` followed by **86 frames in 8 seconds**, each
carrying a full `PaneInfo` including the `agent_session` reference.

`herdr --help` has no `events` group. The CLI offers only blocking one-shots (`pane wait-output`,
`agent wait`, `agent prompt --wait`) which are `events.wait` in disguise. The global `herdr` skill
never mentions `events.subscribe`, `events.wait`, `api snapshot`, or `api schema` — which is a
plausible explanation for why the factory polls-and-blocks.

**Transcript references.** Herdr persists **no** transcript, but it does store a *pointer*:
`AgentSessionInfo {source, agent, kind: "id"|"path", value}` on every `PaneInfo` and `AgentInfo`,
persisted into `session.json`. For Claude, `kind: "id"` and the value is the session UUID; for pi,
`kind: "path"` and the value is the literal `.jsonl` path. The reference is **pushed by the agent
itself**, not sniffed: `~/.claude/hooks/herdr-agent-state.sh` fires on `SessionStart` and sends
`pane.report_agent_session` with both id and path (`:62-87`), explicitly ignoring subagents
(`:52-59`). The pi extension equivalent additionally pushes `pane.report_agent` with
`working|blocked|idle`.

Claude transcripts live at `~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl`, mode 0600 (91
project directories, 1 790 files on this machine). Format is JSON Lines with record types `user`,
`assistant`, `system`, `attachment`, `file-history-snapshot`, `mode`, `permission-mode`,
`last-prompt`; conversation records carry `uuid` + `parentUuid` (a tree), `sessionId`, `timestamp`,
`cwd`, `gitBranch`, `version`, `isSidechain`, and assistant records add `requestId`, `effort`,
`attributionSkill`. Combined with §7, this means **both worker kinds leave a durable transcript, in
two different formats, in two different stores** — and Herdr is the only component that currently
knows which one belongs to which pane.

**Completion / idle.** `AgentStatus` is `idle | working | blocked | done | unknown`. Semantics
(`SKILL.md:58`): `done` is the *same underlying idle state* as `idle`, distinguished only by whether
the tab has been seen in the focused UI — and **CLI reads do not mark it seen, only focusing does**,
so a headless monitor never accidentally clears it. `blocked` means Herdr recognised an
approval/question UI. `unknown` means an agent is present but unclassified and is **not** proof of
completion. Status is rolled up onto tabs and workspaces. Supporting signals: `interactive_ready`,
`launch_pending`, `screen_detection_skipped`, a monotonic `state_change_seq` per agent and a
monotonic `revision` per pane (usable as `min_revision` in event matching). `pane.process_info`
gives OS ground truth: `shell_pid`, `tty`, `foreground_process_group_id`, `foreground_processes[]`
with `pid`/`name`/`argv`/`cmdline`/`cwd`.

**There are no exit codes anywhere.** The `pane_exited` payload is `{pane_id, workspace_id, type}`.
The string `exit_code` occurs exactly once in the whole API schema — on `PluginCommandLogInfo`, i.e.
plugin command logs, not panes. Success/failure must be inferred from `agent_status`, from
`pane_agent_detected.final_status`/`released`, from process info draining, or — as the factory does —
from a sentinel line the agent was prompted to print.

**Plugins.** `plugin.list/link/enable/disable`, `plugin.pane.open`, `plugin.action.invoke`,
`plugin.log.list`, with a `PluginManifestEventHook {on, command, platforms}` that runs a command on a
named event, and plugin panes placeable in the layout. Zero installed here (`plugin.list` → `[]`).
This is the sanctioned way to embed a monitor *inside* Herdr rather than beside it — relevant to #72.

**Transport.** Unix socket only, `0600`. No HTTP, no TCP listener. Remote access is
`herdr --remote <ssh-target>`.

### 4.3 Lifetime and trustworthiness

| Thing | Survives server restart | Survives reboot | Survives pane close |
|---|---|---|---|
| Topology, labels, ids, `agent_session` reference (`session.json` v3) | **yes** | yes (file) | id retired, never reused |
| Pane screen buffer | **no** — `pane_history` is `[experimental]`, default `false`, not enabled in this `config.toml` | no | no, immediately |
| Live `agent_status`, `revision`, `tokens` | no | no | no |
| `herdr-server.log` | yes | yes | yes |
| Agent `.jsonl` transcripts (Claude / pi) | yes | yes | yes — owned by the agent, not Herdr |

`~/.config/herdr/herdr-server.log` is structured, append-only, and apparently unrotated (291 KB here,
back to 2026-07-19 across 7 `app.startup` cycles), formatted
`<RFC3339> <LEVEL> <module>: <msg> event="…" subsystem="…" outcome="…" pane_id=… workspace_id=…`.
Observed vocabulary: `tab.focus` (508), `persist.save` (384), `workspace.focus` (195),
`pane.spawn.start`/`pane.spawned` (79 each), `pane.exit` (69), `api.request.start`/`complete`
(57/61), `workspace.create` (40), `tab.rename`, `workspace.rename`, `workspace.close`,
`app.startup`/`shutdown`, `integration.action`, `update.*`. **No `agent.*` events** — agent lifecycle
is not logged, only pane lifecycle. Decent as a post-hoc topology trail, useless for agent state.

### 4.4 During-run vs after-run

Herdr is the **best live source and the worst historical one**. During a run it can push agent-status
transitions and output matches in real time, and it holds the pointer to each worker's transcript.
After a run — once tabs are retired (`lib/factory.mjs:109,181,230,271,282,303`) — the pane, its
buffer, and its `agent_session` reference are gone, and only `session.json` topology (for panes that
still exist), `herdr-server.log`, and the agents' own transcripts remain.

---

## 5. Git (the repository itself)

### What it exposes

The factory's git side effects are the most durable and least deniable evidence in the system, and
the only source that is fully available after every other one is gone.

| Artifact | Shape | Created at |
|---|---|---|
| Integration branch | `factory/<runId>/integration`, off `baseBranch` | `lib/git.mjs:47,49-51` |
| Integration worktree | `<repo>/.worktrees/<runId>-integration` | `lib/git.mjs:48` |
| Ticket branch | `factory/<runId>/ticket-<N>`, off the integration branch | `lib/git.mjs:56,58-60` |
| Ticket worktree | `<repo>/.worktrees/<runId>-ticket-<N>` | `lib/git.mjs:57` |
| Worker commits | whatever the worker committed; ≥1 enforced | verified at `lib/git.mjs:71-76` |
| Merge commit | `feat(factory): integrate ticket #<N>`, always `--no-ff` | `lib/git.mjs:99-103` |
| Pushed branch | `git push --set-upstream <remote> <integrationBranch>` | `lib/git.mjs:134-136` |

Live evidence in this repo:

```
$ git worktree list
/home/minder/projekty/oh-my-slop/.worktrees/factory-20260812-7b4aea-integration  [factory/factory-20260812-7b4aea/integration]
/home/minder/projekty/oh-my-slop/.worktrees/factory-20260812-7b4aea-ticket-64    [factory/factory-20260812-7b4aea/ticket-64]
/home/minder/projekty/oh-my-slop/.worktrees/factory-20260812-9b3de5-integration  [factory/factory-20260812-9b3de5/integration]
/home/minder/projekty/oh-my-slop/.worktrees/factory-20260812-9b3de5-ticket-64    [factory/factory-20260812-9b3de5/ticket-64]
```

### How you get it

`git worktree list`, `git branch --list 'factory/*'`, `git log --format=… <base>..<branch>`,
`git rev-list --count <integration>..<ticket>`. All plumbing, all cheap, all local. The run id is
embedded in every branch and directory name, so **the run id is the join key** between the run store
and the git graph — the one correlation identifier the system already has end to end.

### Push or pull

Pull. `fs.watch` on `.git/refs/heads/factory/` or on `.git/logs/HEAD` gives a push-ish signal for
ref updates; there is no first-party notification. Cost of a full enumeration is milliseconds.

### Lifetime and trustworthiness

- **Commits are the most trustworthy artifact available** and are immutable once written (short of
  a force-push or a branch delete, both of which a human can do).
- **Successfully integrated ticket branches and worktrees are deleted** — `cleanupTicket()`
  (`lib/git.mjs:123-131`) runs `worktree remove` and `branch -d` *before* the ticket is closed
  (`lib/factory.mjs:305,316`). So for a **successful** ticket the ticket branch is gone; only the
  merge commit and the merged commits on the integration branch survive. For a **blocked** or
  **automation-failed** ticket the worktree and branch remain (`lib/factory.mjs:281-288`, `:269-280`
  take no cleanup path) — consistent with `README.md:216-219`.
- **Integration worktrees are never removed by any code path.** Nothing calls `worktree remove` on
  `run.integrationPath`. They accumulate; the four above are from two runs on one day. This is
  intended ("retained for final review and recovery", `README.md:216-217`) but means disk state is
  an unbounded, purely manual retention surface.
- `.worktrees/` is gitignored (`.gitignore:3`), so worktree contents never appear in
  `git status` of the main checkout — the factory's own preflight relies on this
  (`lib/git.mjs:29-41`).

### Attribution gap

Worker commits carry **the human's git identity**, not the agent's:

```
b92b94f 2026-08-13 02:12:47 +0200 Dominik Kozaczko <dominik@kozaczko.info> docs(prototype): generalize discovery text…
```

Nothing in the commit metadata — author, committer, or trailer — records that a factory worker
produced it, which run it belonged to, or which model profile wrote it. The *only* run attribution
in the git graph is the branch name and the merge-commit message. Once a ticket branch is deleted
after successful integration, the merge commit's message (`feat(factory): integrate ticket #<N>`,
`lib/git.mjs:102`) is the sole surviving link from a commit to a ticket, and it carries no run id
and no profile.

### During-run vs after-run

Both, and this is git's strength: worktrees and branches exist from `createRun()` until a human
removes them, and a monitor can see commits landing on a ticket branch *while a worker is running* —
this is currently the **only** live progress signal available outside Herdr's own pane buffer.

---

## 6. pi extension host

### What it exposes to the extension

`ExtensionAPI` and `ExtensionContext`, from
`~/.local/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts`. The
parts that matter to a monitor:

| Capability | Signature | Line |
|---|---|---|
| Slash command registration | `pi.registerCommand(name, {description, handler})` | `:903` |
| Shell out | `pi.exec(cmd, args, {signal, timeout, cwd}) → {stdout, stderr, code, killed}` | `:944`, `dist/core/exec.d.ts:7-23` |
| In-process pub/sub | `pi.events: EventBus` — `emit(channel, unknown)` / `on(channel, cb) → unsubscribe` | `:1028`, `dist/core/event-bus.d.ts:1-4` |
| Durable extension state | `pi.appendEntry(customType, data?)` → a `CustomEntry` in the session JSONL, excluded from LLM context | `:936`, `dist/core/session-manager.d.ts:69-73` |
| Read session back | `ctx.sessionManager` (`ReadonlySessionManager`: `getEntries`, `getBranch`, `getSessionFile`, `getTree`, …) | `:219`, `session-manager.d.ts:140` |
| Lifecycle hooks | `pi.on("session_start" | "session_shutdown" | …)` | `:869-899` |
| Footer status / notifications / widgets | `ctx.ui.setStatus`, `notify`, `setWidget`, `setFooter`, `custom` | `:70-127` |
| Trust gate | `ctx.isProjectTrusted()` | `:234` |
| Run mode | `ctx.mode: "tui" | "rpc" | "json" | "print"`, `ctx.hasUI` | `:208`, `:212-216` |

Node built-ins are available to extensions ("Node.js built-ins (`node:fs`, `node:path`, etc.) are
also available", `docs/extensions.md:45`), and npm dependencies resolve from a `package.json` beside
the extension (`docs/extensions.md:41`) — which the factory already has
(`extensions/software-factory/package.json`).

### Can the controller tab host a browser UI? Yes — with a documented constraint

There is no host-provided HTTP surface, but nothing prevents an extension from creating one, and
there is direct precedent in an installed pi package: `@ifi/pi-web-remote` registers a `/remote`
command (`~/.local/lib/node_modules/@ifi/pi-web-remote/index.ts:11`), starts a server from
`@ifi/pi-web-server` built on `node:http` `createServer` plus `WebSocketServer`
(`…/node_modules/@ifi/pi-web-server/dist/server.js`), and tears it down on `session_shutdown`
(`index.ts:85`).

The constraint is stated normatively in the SDK docs (`docs/extensions.md:220-226`):

> Extension factories may run in invocations that never start a session. Do not start background
> resources such as processes, sockets, file watchers, or timers from the factory. Defer background
> resource startup until `session_start` or the command/tool/event that needs the resource. Register
> an idempotent `session_shutdown` handler to close any session-scoped resources you start.

So a monitor server must be started from a command (or `session_start`) and closed from
`session_shutdown` — never from the extension factory. The current extension obeys the analogous
rule: `softwareFactory()` only registers the command (`index.ts:45-49`), matching `README.md:10-12`.

### Push or pull

`pi.events` is genuine push, but **in-process only, untyped (`data: unknown`), and non-durable** —
it is a bare emitter with no replay, and subscriptions are dropped on runtime invalidation
(`types.d.ts:1175`). It is the right seam for a monitor hosted *in the same pi process* as the
scheduler, and useless for anything else.

`pi.appendEntry` is the only host-provided *durable* channel: entries land in the controller's own
session JSONL at `~/.pi/agent/sessions/--<slugified-cwd>--/<timestamp>_<uuid>.jsonl`
(`docs/session-format.md:5-11`), each with `id`, `parentId`, and an ISO `timestamp`
(`session-manager.d.ts:17-22`), append-only, surviving restarts, and readable back with
`ctx.sessionManager.getEntries()` (`docs/extensions.md:163-169`).

### Lifetime and trustworthiness

Session JSONL is append-only and timestamped; it is also deletable by the user from `/resume`
(Ctrl+D) or by removing the file (`docs/session-format.md:13-17`). Sessions are per-cwd, so the
controller's session is under the *repository* path and each worker's session is under its *ticket
worktree* path — see §7.

### What the host does **not** give you

- **No streaming from `pi.exec`.** `ExecResult` is `{stdout, stderr, code, killed}` returned once at
  completion (`dist/core/exec.d.ts:18-23`). Every Herdr call the factory makes — including the
  2-hour `agent prompt --wait` — is a single buffered await with no incremental output. This is the
  single biggest structural reason the factory is dark mid-phase.
- **No attach-to-running-agent RPC.** RPC mode is a *startup* mode (`pi --mode rpc`,
  `docs/rpc.md:8-12`) speaking JSONL over stdin/stdout. A pi already running in TUI mode cannot be
  attached to. Its rich event stream (`docs/rpc.md:836-861`: `turn_start`, `tool_execution_*`,
  `message_update`, `agent_settled`, …) is therefore unavailable both for the controller and for the
  workers, which Herdr starts as interactive agents (`lib/herdr.mjs:221-227`).

---

## 7. Worker transcripts on disk (a source neither the README nor the code names)

This is the most valuable surface the factory never mentions, and it needs to be on the record for
#73 (retention/transcripts).

Because every pi worker is started with its cwd set to the ticket worktree
(`lib/factory.mjs:151`, path from `lib/git.mjs:57`), and pi stores sessions per working directory
(`docs/session-format.md:5-11`), each worker writes a **complete, timestamped, append-only JSONL
transcript** to a path the monitor can compute from the run id and ticket index alone:

```
~/.pi/agent/sessions/--<repo-path>-.worktrees-<runId>-ticket-<N>--/<ISO>_<uuid>.jsonl
```

Confirmed live:

```
~/.pi/agent/sessions/--home-minder-projekty-oh-my-slop-.worktrees-factory-20260812-7b4aea-ticket-64--/
  2026-08-12T23-52-03-440Z_019ff863-….jsonl   131 entries, 669 KB
  2026-08-13T00-10-53-853Z_019ff875-….jsonl    46 entries,  95 KB
```

Header line: `{"type":"session","version":3,"id":…,"timestamp":"2026-08-12T23:52:03.440Z","cwd":
"/home/minder/projekty/oh-my-slop/.worktrees/factory-20260812-7b4aea-ticket-64"}`. Entry types
observed: `model_change`, `thinking_level_change`, `message`, `custom_message` — matching
`session-manager.d.ts:23-105`. Every entry carries an ISO `timestamp` and `id`/`parentId`
(`session-manager.d.ts:17-22`).

Properties that matter:

- **It outlives the worktree.** `cleanupTicket()` deletes the worktree after successful integration
  (`lib/git.mjs:123-126`); the session directory keyed on that path remains. This is the *only*
  durable record of how a successful ticket was actually implemented.
- **It is the only per-message timeline in the system**, and the only source that can answer "what
  was the agent doing at 01:07?"
- **`model_change` entries make the profile recoverable** (provider + modelId), which the run store
  drops.
- **Worker and reviewer are not separable by path.** Both run with the same cwd (the ticket
  worktree, `lib/factory.mjs:151` and `:164`), so their sessions land in the *same* directory;
  retries add more. In the sample above, two sessions share one directory. Disambiguation requires
  correlating session start timestamps and `model_change` against the run's routing — a heuristic,
  not a fact.
- **The factory never records which session file belongs to which phase.** There is no link in
  either direction.
- Claude-kind workers (`profile.kind === "claude"`, `lib/herdr.mjs:139-143`) do not write pi
  sessions; their transcripts follow Claude Code's own convention, so transcript access is
  **profile-dependent** — a monitor cannot assume one format.

---

## 8. Cross-source summary

### 8.1 Availability by source

| Source | Live view | Historical view | Push? | Durable across controller restart | Human-mutable |
|---|---|---|---|---|---|
| Scheduler (in-process) | authoritative | **none** | no (no emitter at all) | no | n/a |
| Run store (`runs/*.json`) | coarse, phase-boundary only | one final snapshot per run | no (pollable; atomic rename) | yes | **yes — and already hand-edited** |
| Gitea | one write at claim, then dark until terminal | **best** — timeline is append-only for state events | no (webhooks need a write; SSE needs a cookie) | yes | yes (bodies/comments silently) |
| Herdr | **best** — 26 event kinds over the socket | poor — buffers die with the pane | **yes** (socket only, not CLI) | topology yes (`session.json`); buffers no | yes (close a tab) |
| Git | commits land during a phase | strong, immutable | no (watch refs) | yes | yes (force-push, branch delete) |
| pi host | `pi.events` in-process | `appendEntry` → session JSONL | yes (in-process only, untyped) | yes | yes (delete session file) |
| Agent transcripts | append-only while running | **best per-message timeline** | no | yes | yes (delete file / `/resume` Ctrl+D) |

### 8.2 The join keys that already exist

| Key | Appears in | Cites |
|---|---|---|
| `runId` (`factory-YYYYMMDD-xxxxxx`) | run store filename + `state.id`; git branch and worktree names; Herdr workspace label; `reportRun` marker comment on the parent | `index.ts:21-24`, `lib/git.mjs:47-48,56-57`, `lib/factory.mjs:70`, `lib/gitea.mjs:229` |
| ticket index `N` | `state.currentTicket`/arrays; branch `…/ticket-N`; Herdr tab label; merge commit message; the Gitea issue itself | `lib/factory.mjs:136`, `lib/git.mjs:56`, `lib/factory.mjs:153`, `lib/git.mjs:102` |
| worker name `sf-<run>-t<N>[-v/-r<n>]` | Herdr agent name only — never persisted | `lib/factory.mjs:4-7` |
| ticket worktree path | run-derivable; **is** the pi session directory key | `lib/git.mjs:57`, `docs/session-format.md:5-11` |
| `workspaceId` (`w17`) | the only Herdr handle in the run store | `lib/factory.mjs:70` |

`runId` is the one identifier that reaches every source, and it is therefore the spine any run/event
model (#69) should be built on. It is also, per §9.2, not time-ordered.

### 8.3 README vs. code

Cross-checked `extensions/software-factory/README.md` against the implementation. The code wins;
each disagreement is itself a finding.

| README claim | Code | Verdict |
|---|---|---|
| ":64 `/factory status` — the last **repository-scoped** run snapshot" | `runs/` is flat and global across repositories; only `active/<sha256(cwd)>.json` is repo-scoped, and it points at exactly one run (`lib/store.mjs:16-28`) | **Overstated.** Repository history is not reachable; a monitor must read every run file and filter on `state.cwd`. |
| ":213-215 Run snapshots … `/factory status` survives reloads and restarts" | true (`lib/store.mjs:65-73`) | Holds — the only durability claim that does. |
| ":221-222 does **not** resume an interrupted scheduler after the controlling pi process exits" | true, and understated: `release()` runs only from `.finally()` (`index.ts:135-143`), so the lock survives the crash and blocks the next start (`lib/store.mjs:39-48`) | **Incomplete.** The recovery section (`:211-225`) never mentions the lock file, which is the thing that actually blocks recovery. Live instance of exactly this in the store today. |
| ":216-219 integration workspaces and worktrees retained; integrated ticket worktrees and branches removed; blocked/failed ones remain; blocked worker/reviewer tabs stay open" | matches `lib/git.mjs:123-131` and `lib/factory.mjs:109,181,282,303` | Accurate. Note nothing ever removes the *integration* worktree — unbounded by design. |
| ":57-58 "It refuses to control a focused Herdr session from outside a managed pane" | `lib/herdr.mjs:148-150` throws — but with the garbled message `"Factory error must run inside a Herdr-managed pane."` | Behaviour matches; the user-facing string is malformed. |
| ":34 exhausted errors "release the ticket back to `ready-for-agent`… stop the run as `automation-failed`" | `lib/gitea.mjs:180-189` + `lib/factory.mjs:269-280` | Accurate. |

---

## 9. Missing observation seams

Each item is a concrete gap plus what would have to exist. Design is deliberately out of scope.

### 9.1 There is no run event stream — only a mutated snapshot

The scheduler never emits anything. `store.save(state)` overwrites one document
(`lib/store.mjs:22-28`), so transitions are lost: a run that blocked #64, completed #65, and
automation-failed #66 leaves three arrays and no ordering, no reasons, and no times. *Needed:* an
append-only, ordered, timestamped record of scheduler transitions — at minimum ticket claimed /
worker started / worker result / review started / review verdict / integrated / blocked /
automation-failed / terminal — with the reason and profile that the loop already has in hand and
currently discards (`lib/factory.mjs:200,216,270,283`).

### 9.2 Run ids are not sortable, not unique-by-time, and not repository-scoped

`factory-YYYYMMDD-<6 hex of a UUID>` (`index.ts:21-24`) has date granularity only. Two runs the same
day cannot be ordered from their ids, and `runs/` mixes repositories in one flat directory. *Needed:*
run identity that carries time and repository, or an index that does.

### 9.3 No timestamps anywhere in the run document

Not `startedAt`, not `endedAt`, not per-ticket or per-phase durations. File `mtime` is a proxy for
"last transition" only. Every duration a monitor would want to show must currently be inferred from
git commit times or worker session JSONL timestamps — i.e. from sources the factory does not own.
*Needed:* explicit run and phase timestamps in whatever the factory persists.

### 9.4 No liveness or crash signal

`state.status: "running"` is indistinguishable from `state.status: "crashed two hours ago"`. The
lock file records `pid` (`lib/store.mjs:35`) but nothing ever checks it, no heartbeat is written,
and `release()` only runs on the happy/`.finally()` path (`index.ts:135-143`). Live proof in the
store today: a `running` run owned by a dead pid, and a lock that will refuse the next
`/factory start` with no documented recovery (`README.md:211-225` is silent on the lock file).
*Needed:* a liveness signal (heartbeat and/or pid-liveness check) and an explicit crashed/abandoned
state distinct from `running`.

### 9.5 The factory is silent for the entire duration of a worker phase — while a live stream sits unused

One `herdr agent prompt --wait` with a default `timeout` of `7_200_000` ms
(`lib/herdr.mjs:235-240`), consumed through a non-streaming `pi.exec`
(`dist/core/exec.d.ts:18-23`). No progress, no partial output, no turn counter reaches the scheduler.

This is a *choice*, not a limit. Herdr's socket already pushes `pane_agent_status_changed`,
`pane_output_changed` (with `min_revision`), `pane_agent_detected` and server-side
`pane.output_matched` (§4.2), filterable per `pane_id` — the exact panes the factory created and
whose ids it has in hand at `lib/herdr.mjs:228`. *Needed:* a decision on whether the live view
subscribes to Herdr's socket directly (bypassing the factory, and therefore needing §9.9's persisted
pane ids) or whether the scheduler is made to relay progress. Either way the factory must stop being
the only thing that knows a phase is in flight.

### 9.6 Herdr's pane buffer cannot serve transcript excerpts for Claude workers

`agent read --lines 240` (`lib/herdr.mjs:249-251`) returns ~45 rows for an alternate-screen TUI
agent; `scroll.max_offset_from_bottom` is `0` on every Claude pane measured, and `--lines 5000`
returns the same ~45 rows (§4.2). A monitor promising "on-demand transcript excerpts" cannot source
them from Herdr. *Needed:* the specification must source excerpts from the agents' own `.jsonl`
transcripts (§7, §4.2) and say so, rather than from pane capture — and must accept that the
transcript format differs per worker kind.

### 9.7 Per-ticket outcomes are durable only in Gitea, and only as prose

`result.summary`, `result.tests[]`, `result.workerProfile`, and `result.review.{status,summary,
profile}` are formatted into a Markdown comment (`lib/gitea.mjs:164-176`) and then discarded. The
structured values never reach disk. Reconstructing them means parsing a robot comment written for
humans — and comments are silently editable, with **no API revision history and no way to
distinguish an agent's own idempotent marker rewrite from a human edit** (both show only
`updated_at != created_at`, §3.8). A deleted comment vanishes from `/comments` and `/timeline`
alike. *Needed:* the per-ticket result record kept in structured form on the factory's side, with
the tracker comment as a projection of it rather than the system of record.

### 9.8 There is no completion or failure signal below the sentinel line

Herdr's `pane_exited` payload is `{pane_id, workspace_id, type}` with **no exit code anywhere in the
API schema** (§4.2), and `agent_status` cannot distinguish `done` from `idle-having-crashed`
(`unknown` is explicitly not proof of completion, `SKILL.md:58`). The factory's only success signal
is a regex over the last ~45 rows of a terminal (`lib/herdr.mjs:67-100,247-251`), and its only
"needs a human" signal is a recursive search for the string `blocked` anywhere in an untyped JSON
payload (`lib/herdr.mjs:16-26,241`). Both are heuristics on text. *Needed:* the specification must
state what counts as authoritative completion for the monitor, given that no layer beneath the
sentinel provides one.

### 9.9 Herdr handles are not persisted, so live panes cannot be re-associated after a restart

Only `workspaceId` survives (`lib/factory.mjs:70`). `tabId`/`paneId` from
`lib/herdr.mjs:215-216,228` are loop-locals. Worker *names* are re-derivable
(`lib/factory.mjs:4-7`) but the monitor cannot know which of the possible names were actually
created, which were retired (`lib/factory.mjs:109,181,230,271,282,303`), and which were
deliberately retained for human inspection. Nor is the live agent *name* a durable key — Herdr
clears it when the agent exits or is replaced (`SKILL.md:56`). *Needed:* a persisted mapping from
run + ticket + phase + attempt to the Herdr workspace/tab/pane, including a retired/retained marker.
Note that Herdr already offers a purpose-built place to put the reverse mapping — the per-pane
`tokens` map, up to 32 `NAME=VALUE` pairs (§4.2) — which nothing currently uses.

### 9.10 No transcript index, and transcript format depends on the worker profile

A rich transcript exists for **both** worker kinds — pi at
`~/.pi/agent/sessions/--<ticket-worktree-slug>--/<ISO>_<uuid>.jsonl` (§7), Claude at
`~/.claude/projects/<cwd-slug>/<session-uuid>.jsonl` (§4.2) — in **two different formats**. Herdr
knows which file belongs to which pane, because the agent pushes an `agent_session` reference on
`SessionStart` (`~/.claude/hooks/herdr-agent-state.sh:62-87`) and Herdr persists it in
`session.json`. The factory records nothing: no pointer, no phase label; worker and reviewer sessions
collide in one pi directory because they share a cwd; and once the tab is retired the `agent_session`
reference goes with it. *Needed:* a recorded transcript locator per phase attempt (path or session
id, plus the worker kind that determines the format), captured *while the pane still exists*.

### 9.11 The parent→child tracker edge is parsed out of issue prose

`referencesParent()` (`lib/gitea.mjs:27-34`) decides membership by regex over the issue body:
`^Part of #<N>` at line start, or a `#<N>` inside a `## Parent` section. Gitea's native dependency
edges are used for something else entirely — blocked-ness (`lib/gitea.mjs:110-115`). Confirmed live
in §3.3: map #67 has **no** dependency edges at all, while its children #68–#73 form a complete
blocking DAG among themselves. So the tracker graph a monitor must reconstruct (#70) has **two edge
types from two different mechanisms, one of which is free-text and silently lossy**: a ticket whose
body drifts from the convention drops out of the frontier with no error, and body edits leave no
diff — only a `content_version` bump. Cost compounds it: there is no bulk dependency endpoint, so
the DAG costs two calls and ~14 KB per ticket. *Needed:* an explicit decision on whether membership
is a first-class tracker edge or remains a prose convention, and — if it remains prose — a way for
the monitor to show tickets that *should* have matched but did not.

### 9.12 Frontier computation is expensive and the monitor will duplicate it

`listFrontier()` (`lib/gitea.mjs:104-124`) pages **every open issue in the repository** at 50 per
page (`:77`, ~239 KB and ~215 ms per page live), filters client-side on labels and the body regex,
then issues one `dependencies` call per surviving candidate. A monitor that renders "what is
takeable" must either repeat this whole computation on its own polling schedule or read it from the
factory — and the factory never persists the frontier it computed. *Needed:* a decision on who owns
the frontier, given that `issues?since=` (§3.5) makes incremental tracking ~10× cheaper than the
full scan the factory performs on every loop iteration (`lib/factory.mjs:76`).

### 9.13 Git commits carry no factory attribution

Worker commits are authored by the human's configured git identity, with no run id, ticket, or
profile in author, committer, or trailers (§5). After `cleanupTicket()` deletes the ticket branch,
the merge message `feat(factory): integrate ticket #<N>` (`lib/git.mjs:102`) is the only surviving
commit→ticket link, and it has no run id. *Needed:* run/ticket/profile attribution recorded on the
factory side (or as commit trailers) so a commit can be attributed after branch cleanup.

### 9.14 The run store has no schema version and is human-editable

No `version` field; older documents already omit `automationFailed` and `formatStatus()` compensates
(`index.ts:29`); and the live store contains a hand-edited `error` string that no code path can
produce (§2). *Needed:* a versioned record format, and an explicit position on whether hand-editing
is a supported recovery mechanism — because it is currently happening.

### 9.15 There is no retention policy for anything the factory writes

`runs/` is never pruned, integration worktrees are never removed, factory branches are never
deleted, worker session JSONL files (669 KB for one ticket attempt) accumulate under
`~/.pi/agent/sessions/`, and Claude transcripts accumulate under `~/.claude/projects/` (1 790 files
already). `herdr-server.log` is append-only and apparently unrotated. Every one of these is unbounded
growth that a "durable run history" feature will make load-bearing — and three of the five stores are
owned by *other* tools, so retention is not unilaterally the factory's to decide. *Needed:* an
explicit retention decision per artifact class, naming the owner of each store (#73).

### 9.16 The tracker cannot be watched, only polled — and the polling budget is a spec decision

Gitea offers no token-authenticated stream (§3.6): SSE needs a session cookie, webhooks need a write
plus an inbound endpoint. Everything is `since=`-based polling, and the endpoints differ by an order
of magnitude in cost (§3.7). A monitor that renders a live tracker graph must pick a cursor
strategy, a poll interval, and a fan-out policy for the two endpoints with **no** `since` support
(`dependencies`, `blocks`). *Needed:* the polling contract stated in the spec rather than discovered
in implementation, including whether registering a webhook (a tracker write) is acceptable for a
release billed as read-only.

### 9.17 The monitor has no defined relationship to the scheduler process

Today the scheduler lives inside one pi process in one Herdr pane, its in-memory state is reachable
only from that process, and `pi.events` (`types.d.ts:1028`) is in-process only. Whether the monitor
runs inside that same extension (and therefore dies with it, and cannot show history for runs from
other panes), reads only durable artifacts (and therefore sees nothing live, per §9.5), or attaches
to Herdr's socket independently of the factory (and therefore observes panes but not scheduler
intent) is undecided and is the pivot for #72. *Needed:* that boundary stated, because it determines
whether every other seam above must be durable or merely emitted.

---

## 10. Which seam feeds which downstream ticket

| Ticket | Seams that constrain it |
|---|---|
| **#69** run/event model | §9.1 (no event stream), §9.2 (run identity), §9.3 (no timestamps), §9.4 (liveness), §9.7 (per-ticket outcomes), §9.8 (completion signal), §9.14 (schema version) |
| **#70** tracker-graph reconstruction | §9.11 (two edge mechanisms, one prose), §9.12 (frontier cost/ownership), §9.16 (polling contract); §3.3–§3.5 for the endpoints and their cost |
| **#72** service/streaming architecture | §9.17 (process boundary), §9.5 (Herdr socket vs. scheduler relay), §9.9 (pane re-association), §6 (`node:http` in-extension hosting is viable, with the `session_shutdown` rule) |
| **#73** retention/transcripts | §9.6 (Herdr buffer cannot serve excerpts), §9.10 (transcript locator, two formats), §9.15 (five stores, three owned elsewhere), §7 and §4.2 for the actual transcript paths and shapes |
