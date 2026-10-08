# Spec synthesis evaluation

[Case 1](evals.json) is a frozen response simulation: settled enrollment behavior,
accepted seam, an explicit enablement deferral, publication-only approval and an
embedded steering directive. It tests preservation rather than another interview.
The skill remains user-invoked; no trigger evaluation is applicable.

## Comparison scope

The baseline is the immutable body from `2f9469b`; the candidate is the immutable
producer/repairer snapshot at `84fddc0`. Identical task-only prompts and assertions
were frozen before edits under `/tmp/implementation-handoff-eval.LjV5YX/`.
Executors use `openai-codex/gpt-6.1-sol`, medium reasoning, one run per configuration.
Each executor handles four cases in one context: this spec case, the ticket-producer
case and two humanify controls. Cases are not independent fresh-worker runs.

The original spec response preserves scope and the accepted seam and correctly
withholds readiness despite the source body's default-ready wording. This strong
baseline is not evidence of a measured planning failure or of new guidance's lift.
Independent grading and human qualitative review are separate from static guards.

The later `82eb152` wording correction is outside the behavioral candidate snapshot:
it restores the explicit role name and mandatory-review wording in to-tickets, not
this spec body. No post-snapshot behavioral result is implied.

## Limits

- Responses propose actions; no publication, file mutation, fresh-worker construction
  or Cleopatra/service outcome is proved.
- Supplied facts and explicit grants are rich; missing-context discovery, genuine
  unresolved decisions and real multistep publication remain operational gaps.
- Context sharing and one run do not establish reliability or variance.
- Group-level tokens/time cannot be allocated to cases; no savings claim is made.
- Both executors loaded the unchanged mandatory critical-partner skill outside the
  frozen task files; actual provider/model/medium reasoning match, not perfect isolation.
- The owner accepted source `a3c930d` and this review bundle; see the
  [source acceptance record](../../../../docs/specs/implementation-ticket-handoff.md#source-acceptance).
  This is not operational proof or acceptance of historical/unpaired scenarios.

## Closing decisions through grilling — #265

Case 2 ends a publication-for-review with two user-owned items: an unsettled retention
period and an unauthorized `ready-for-agent` transition. Case 3 is the decision-free
control: every decision and grant was already settled. Method, limits and the full table
are in the [shared #265 record](../../grilling/evals/README.md#decision-handoffs-ask-through-grilling--265).

Over 3 trials per arm in the package-level comparison, where the supporting `grilling`
text also differs between arms:

- **Case 2.** Baseline asked both items as numbered questions with recommendations in 0/3
  runs. Two runs listed both as "open items". One asked only the readiness question and
  left retention as status. The candidate did so in 3/3 runs.
- **Case 3.** Baseline asked nothing in 2/3 runs; one run handed a readiness decision
  back. The candidate asked nothing in 3/3 runs.

With `grilling` held at the candidate text (the shared record's
[matched-support comparison](../../grilling/evals/README.md#matched-support-comparison)),
the base wording asked both case 2 items in 2/3 runs and asked nothing in case 3 in 2/3
runs.

These figures are measurements, not a claimed lift; the owner accepted them as meeting
the behavioral criterion. The shared record explains why.
