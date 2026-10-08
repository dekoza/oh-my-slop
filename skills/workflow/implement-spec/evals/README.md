# Implement-spec evaluation and pilot

## Provenance and scope

Adapted from the [upstream source rollout at the inspected pin](https://github.com/mattpocock/skills/blob/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering/implement-spec/SKILL.md).
This is source provenance, not a claim of a published v1.3 package or a verified
Cleopatra interface. The coordinator is a manual technique for one supervised
session, not a durable execution service.

## Scenario comparison

Scenarios 1–3 cover dependent dispatch while tracker issues stay open, a moved
integration tip with skipped acceptance coverage, and exhausted repair/publication
authority under an embedded steering directive. Prompts and assertions were frozen
before the body was drafted.

The workspace is `/tmp/implement-spec-adaptation.xYIF75/implement-spec-workspace/iteration-1`.
Compare ordinary reasoning without the coordinator against its immutable candidate
snapshot. Both configurations have the same prompt/tool boundary and the same old
worker guidance, holding that dependency constant to isolate coordinator text.
The updated worker is evaluated separately. This is not an end-to-end comparison
of two deployed packages.

The baseline is already strong on most safety decisions. Each configuration uses
one general-purpose executor answering three scenarios, without model/thinking
overrides. Recovered executor transcripts verify `openai-codex/gpt-6.1-sol`
with high reasoning in both configurations. There are no independent repeated
runs or variance estimate; per-scenario timing/cost is unavailable. Group metadata
is recorded separately; the harness token figure counts uncached input plus
output, excluding cache reads. All answers are proposed actions: no workers,
Git integration, tracker mutations, paid external CLI sessions or services execute.
Formal grades and human review must not be confused with an operational benchmark.

Independent grading found **12/12 assertions passed in both configurations**: all
three cases pass every assertion with and without the coordinator. No measured
assertion-level lift or regression was observed. The proposed guidance may make
ownership and evidence more explicit, but usefulness and reduced dispatch effort
remain qualitative/operational questions, not conclusions of this sample.

The graded coordinator body is the immutable `4c75512` candidate and has not changed
since that comparison. Standard benchmark and review viewers were generated in the
recorded workspace; human qualitative review is pending. Per-case cost/timing is
unavailable, and generated zero-valued summaries mean no measurements, not zero
cost. Read the analyst notes on leading prompts and always-passing controls before
interpreting the aggregate score.

## Handoff-consumer continuation

Case 4 adds a definitive-brief/changed-input dispatch check and an unchanged-input
counterfactual preserving run-local eligibility. Its paired proposed-action comparison
starts from `5b1588b` and uses the immutable consumer body through `2595b9a`; the older
12/12 comparison above does not cover this change. See the
[routing comparison](../../wayfinder/evals/README.md) for artifacts, source boundaries,
rubric exposure, strong-baseline and shared-context limitations. The owner accepted
this continuation's source and bundle at `c2304db`; the older coordinator comparison
above is a separate artifact. Fresh configured skill discovery is verified in the
[handoff spec](../../../../docs/specs/implementation-ticket-handoff.md#runtime-discovery-verification);
active-session reload and real dispatch/publication evidence remain pending.

## Static and Git checks

`tests/test_implement_spec_skill.py` protects manual invocation, worker dependency
closure, run-local versus tracker eligibility, bounded integration and honest final
handoffs. Its real Git fixture creates divergent worker/integration histories,
shows the old worker cannot fast-forward the moved tip, and verifies that a new
merge candidate preserves both committed changes and an untracked recovery file.
The install-contract regression first failed with the coordinator absent.

These fixtures establish the Git failure mode and the available instruction
contract. They do not establish that a model follows it across dispatch, integration
and publication. `tests/test_prompt_templates.py` checks the argument-forwarding
manual entry point; package/frontmatter/reference checks cover discoverability.

## First operational pilot — pending

Select an owner-approved Cleopatra milestone with 2–3 build-ready tickets and a
real blocking relationship; do not infer a milestone from this library's setup.
Start serially. Admit a disjoint pair only after inspected ownership, available
resources and the operator's worker cap support it.

Record actual worktree/branch effects, worker base and delivered SHAs, checks and
skips, review outcomes, integrated SHAs, the complete requirement trace, repair
spend and dispatch effort. The pilot must advance an internal prerequisite without
premature issue closure, reverify a changed integration candidate, refuse missing
required coverage, stop at a repair limit and preserve unrelated/untracked state.
Deliver the agreed combined PR or branch-only result while retaining human-owned
acceptance. Compare dispatch effort with manually running the same slices; proposed
actions and skill-load receipts are not execution proof. This pilot has not run.

## Closing decisions through grilling — #265

Case 7 ends a combined delivery with three operator choices: advisory follow-up, a glossary
gap returned by a worker, and authorization to close the parent spec. Method, limits and
the full table are in the
[shared #265 record](../../grilling/evals/README.md#decision-handoffs-ask-through-grilling--265).

Over 3 trials per arm in the package-level comparison, where the supporting `grilling`
text also differs between arms, baseline asked all three as one numbered round with
recommendations in 0/3 runs. It listed them as "unresolved obligations", folded them
together, or ended with "The run stops here." The candidate did so in 3/3 runs.
No run closed issues, merged or filed tickets.

With `grilling` held at the candidate text (the shared record's
[matched-support comparison](../../grilling/evals/README.md#matched-support-comparison)),
the base wording asked all three in one round in 2/3 runs.

These figures are measurements pending owner direction, not a claimed lift. The shared
record explains why.
