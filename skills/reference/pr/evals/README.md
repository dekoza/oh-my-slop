# PR presentation evals

[Functional/retrieval definitions](evals.json) cover the three real presentation
owners: implement's standalone body/branch-only handoff, implement-spec's combined
delivery, and fix-pr's existing repair comment. Use operator-supplied disposable
filesystem/Git fixtures, their exact templates and metadata, configured custom
language, committed candidates and actual read-only check outputs. Preserve
unrelated/untracked work; only authorized local draft artifacts may be written.
Forge, approval and CI facts supplied by fixtures are simulations, not live evidence.

Compare one trial for each of three cases with the no-pr baseline first and candidate
second (six initial CLI executions maximum). Preserve complete pre-edit owner/support
bodies and evals. Keep prompt, inputs, tools, model/thinking, fixture and deadlines
matched; baseline omits pr, candidate includes it. Read actual handoff bodies rather
than count requires metadata as consultation. Grade draft contents and tool/filesystem
and Git effects separately from static source assertions. Strong baselines may tie;
no lift, reliability or efficiency claim follows from this small sanity comparison.

[Trigger queries](trigger-evals.json) use the existing query/should_trigger format:
ten natural positives and ten adjacent near-misses, three serial trials each, sixty
initial executions maximum, candidate-only and threshold 0.5. Advertise the natural
candidate description through the installed pi CLI; do not force its name or append
its body. Use the declared isolated JSON-stream executor and existing provider/model,
not the skill-creator OpenCode detector. A genuine consultation correlates an actual
read start/end by toolCallId and canonical path, successful returned instruction body,
and inspected offset/limit. Frontmatter-only, failed or claimed reads are not positives.
A qualified backend response requires exit0, agent_settled and terminal assistant
message_end stop, with complete correlated lifecycles and no unresolved backend fault.
For the retrieval-only interpretation explicitly selected below, failed candidate-SKILL
reads, non-read tool errors, uncorrelated/pending events, aborts, missing events and
timeouts remain INCOMPLETE, not negatives. Retain auxiliary context read errors
separately: they do not invalidate successful target-SKILL consultation under that
interpretation, but never establish successful auxiliary lookup or task completion.
A failed candidate read is INCOMPLETE even if another read succeeds. Split raw JSONL
on LF. Process300/outer600; no automatic retries or extra optimization batch.
Changed/unavailable resources block the affected gate.

Keep full raw stdout, separate stderr, command/cwd/source/input hashes, timings,
objective grades and standard Outputs/Benchmark and trigger-set viewers durably
outside installable skills. The operator owns future qualitative acceptance after
seeing outputs; source tests and collector qualification do not establish it.
Definitions are not passing measurements. Both independent candidate-bound review
axes and required repository checks remain separate completion gates.

## Initial evidence and bounded recovery — 2026-10-02/03

Durable evidence root:
`/home/minder/.local/state/oh-my-slop/preflight-248-1fO63Nx1/worker-251/`.
Original freezes, raw streams, grades and viewers remain unchanged. The initial six
functional executions scored cases1/3 **4/4 each**, combined case2 **3/4 each**:
11/12 per configuration, a tie. Both combined arms wrote two unowned `/tmp` check
logs beyond their two-draft grant. Preexistence/ownership and actual loss are unknown;
those scope failures are not retrospectively authorized or removed.

The original sixty trigger executions completed exit0/stop/settled, but the frozen
ANY-failed-tool rule qualified **26**, leaving **34 INCOMPLETE**. All thirty positive
trials returned the full PR instruction body; fifteen were excluded solely for
auxiliary lookup errors. This original protocol remains incomplete, not passed.

After inspecting those outcomes, the operator selected `A, yes`, then confirmed
`yes`: labelled **POST-HOC** target-SKILL/backend reanalysis, ZERO new trigger
executions, and exactly two prospective combined-only functional executions.
The selection receipt and full audit are under `repair-1/`; resource selection is
not qualitative acceptance. `trigger-post-hoc-complete/matrix.json` and `.md`
retain all60 original/new classifications, full returned bodies, raw/input/source
bindings and errors. Under A, all60 qualify for the retrieval-only metric: positives
3/3 and near-misses0/3, all20 queries meet threshold0.5. **135 auxiliary read errors
across34 trials remain reported**, not successful whole-task completion. The standard
`trigger-post-hoc-complete/review.html` includes original outputs alongside new
qualification; `report.html` is a POST-HOC report, not an optimization, holdout,
original-protocol pass, causal lift, reliability or efficiency result. Its generic
upstream OpenCode/optimization prose does not describe this installed-pi audit.
The initial `trigger-initial/review.html`, matrix and subset-only report remain visible.

The separate corrected combined cohort prospectively froze fresh owned native Git
fixtures and exactly four writable filenames per arm: draft, authority note, baseline
check log and head check log. No instruction, assertion, template, domain, committed
base/head, pressure, recovery or publication authority changed. Baseline then candidate
used the same pi1.0.0/openai-codex/gpt-6.1-sol/high, isolation/tool/deadline plan,
with GIT_OPTIONAL_LOCKS=0 identically to prevent optional index refresh writes.
Both completed **4/4**, a tie: actual full owner/PR-body reads, executed equivalent
sorted outputs, two draft writes and authorized tee logs were verified. Every bash
write was audited, including the baseline's local draft-link correction; native
refs/index/tracked/untracked bytes remained unchanged. Evidence and the standard
Outputs/Benchmark viewer are under `repair-1/combined-recovery/functional/iteration-1/`
(`review.html`). Cases1/3 are reused only for verified identical guidance/inputs,
with explicit provenance; the original failed case2 and11/12 aggregate stay unchanged.
Do not manufacture a homogeneous aggregate from these separate cohorts.

Usage is **initial6 + new2 functional, initial60 + new0 trigger**, no retries or
modelled reviews. These are worker-owned sanity grades, not independent benchmarks
or qualitative judgments. Both new functional runs preceded this eval-README-only
metadata edit; all evaluated instruction/description/support bytes remain unchanged
from their selected9ef baseline/7d candidate. Both ordinary independent whole-candidate
axes and **NEW operator Outputs/Benchmark acceptance remain pending**. No integration,
publication, tracker mutation, dependent release or renewed resource budget is implied.
