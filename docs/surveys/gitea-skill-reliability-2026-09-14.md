# Gitea skill reliability and tracker scaffold migration

## Evidence

A local session survey paired 185 distinct comment-related tool calls with
`Error: no comment content provided`: 8 in pi and 177 in Claude Code. These are
observed errors, not comparative harness failure rates. Two Claude sessions loaded
the Gitea skill body immediately before using the add shorthand to read comments;
the applicable issues reference was not explicitly read first. A pi session
corrected its issue syntax after loading the skill, then repeated invented syntax
after compaction. The private transcript paths and raw survey artifacts are not
part of this package.

The recurring mistakes include `tea comments <index>` for reading, invented
`tea issues view` / `tea issues comment` / `tea api get` verbs, CLI `--body`, API
`-o json`, and stdin redirection without an explicit request body flag. The update
keeps the existing `gitea` name and separates reference retrieval from registration.

## Consumer migration

The Gitea scaffold and this repository's tracker document now scope repository
commands with `--repo owner/name`. `--remote` participates in discovery rather
than replacing an explicit owner/repo binding. Current tea 0.15.1 probes actually
resolved this repository correctly without scope flags; the old skill's categorical
inference-failure claim was stale. The dependency recipe supplies `index`, `owner` and
`repo`, checks HTTP success and reads back the edge. Comment creation and issue
closure are separately verified outcomes. PR creation pushes to the configured
Gitea remote, not an assumed GitHub `origin`.

Existing consumer repositories must **re-sync with `/setup-project-skills`** to
replace old command scaffolding. Preserve their tracker bindings, login choices,
labels, authority rules and local edits; show the proposed diff before writing.
The protected tracker headings and `## Agent skills` pointer contract do not change.
No other repository is edited automatically by this update.

## Validation results

Repository checks: **908 Python tests passed**, and the Markdown reference validator
passed. Functional/retrieval comparisons and real-client probes are separate evidence;
a documentation test is not proof of agent behavior.

The matched comparison used actual pi and Claude Code CLIs with constrained fixture
tools, not a real tracker or unrestricted Bash. Both configurations used identical
prompts, fixture/tool hashes, model settings and injected memory (apart from its
timestamp). The skill body was supplied explicitly, so these runs do not measure
automatic discovery. One run per scenario/configuration gives no variance estimate.

| Comparable scenario | Original → candidate assertions |
|---|---|
| Claude (`claude-opus-5`), post exact file contents once | 2/5 → 5/5 |
| Claude, pagination and HTTP500/exit0 handling | 4/5 → 5/5 |
| pi (`gpt-5.6-luna`), pagination and HTTP500/exit0 handling | 4/5 → 5/5 |

The candidate Claude posting run read both references, selected explicit comment
list, checked the marker, posted through `-F body=@file`, and read back an exact
body including its trailing newline. It made no close request. Its additional claim
that the issue was open is **unverified**: the fixture stores comments, not issue
state. Completed pagination candidates cited total/count evidence and rejected the
HTTP500 response despite process exit0. Required references were loaded before
operational work in the completed candidate cells.

### Limits and remaining work

- Provider overload prevented candidate pi read/post outcome comparisons. Those
  incomplete cells are not skill failures or successful validations.
- PR-read completion is excluded from comparative conclusions because the fixture
  omits valid PR review endpoints. Raw outputs remain available for review.
- Pi pagination finished model work but its process remained alive until the
  180-second timeout; that duration is not model execution latency.
- Existing memory hooks supplied domain hints in both configurations. Keeping that
  context identical permits a comparison, not a claim about the skill in isolation.
- Seven additional functional scenarios are defined but were not run. Trigger
  measurement is deferred because the configured `opencode` optimizer is unavailable;
  the existing description was retained, not claimed to be optimized.
- The operator approved the eval set. Qualitative review of the candidate outputs
  remains pending; no general reliability or qualitative-superiority claim is made.
- Claude's local skill symlink sees the repository changes. Pi's separate managed
  package checkout still needs a normal update after publication; it was not silently
  overwritten. Other consumer repositories still need the re-sync described above.

Standard static review viewers and raw transcripts/grades are retained in the local
evaluation workspace, not published with private session/memory content. The skill's
versioned operational observations and eval instructions document how to revalidate.
