# Selected compact review route

Use this branch only when the caller explicitly selected compact evidence. Without that
selection, keep the ordinary path and its existing review gates. This is guidance for the
existing review owners, not a new orchestrator or permission to spend, edit or publish.

## Admit the route before building

The caller verifies the launcher, reviewer definition, exact available provider/model pin,
read-only capabilities, separate fresh contexts and finite invocation/turn/time/spending
grant **before implementation dispatch**. Capability inspection is local/read-only: run
**no model/API probe**. Missing capability is a caller-owned gap. A selected compact route
must not silently fall back to ordinary reviews or sequential shared-context assessment.
Turn/time limits are **not a token ceiling**; do not report a monetary/token bound unless
it is actually enforced. Unknown cost/timing remains unknown, not zero.

The maintained @tintinweb/pi-subagents compact adapter accepts the request on its existing
spawn RPC as `options.reviewEvidence`; a harness version that also exposes it on the
**top-level Agent** tool names it `review_evidence`. Both accept
`{ axis: "spec" | "standards", manifest: { path, sha256 } }`. Check the installed tool schema
and the harness RPC reference rather than assuming either option exists in this install.
**Nested Agent and workflow agent() do not expose it.** Their top-level caller dispatches
reviews and returns complete outcomes to the worker. The worker stays awaiting review;
preparing evidence is not a completed handoff. Do not add another launcher or weaken the
fresh-context requirement to work around a missing interface.

## Index actual candidate evidence

Construction still owns actual ordered RED/GREEN, required final checks, current source and
environment identity, and the requirement/coverage matrix. Before review dispatch, prepare
one caller-verified manifest outside the clean pinned candidate checkout. Bind its retained
brief, policies, axis rubrics, command stdout/stderr/exit status/timeouts, requirement evidence,
route fingerprint, repair budget, human-owned work, publisher and delivery boundary to exact
hashes. The existing harness validator admits this manifest; use its installed schema rather
than creating a second schema here. Planned commands, labels and claimed success are not receipts.

Keep each axis's prompt, rubric, findings and context independent. Dispatch each approved axis
through the verified top-level route. Foreground Agent calls return the compact JSON envelope;
for background calls, retrieve the full settled outcome rather than a preview notification.
Retain raw logs outside model input and read them only for an actual evidence/debugging need.

## Complete the unchanged gates

Require **both independent axes** to finish their assigned source scope. Inspect full findings,
limitations and coverage, candidate/manifest bindings, terminal status and retained artifact
hashes. Coverage declarations and transport success do not prove semantic completeness.
Missing inputs, omissions, truncated/error output, wrong identities or unknown permissions
leave review **incomplete**, even with zero findings. Use the harness handoff validation; its
complete envelope does not independently execute supplied checks or grant acceptance.

For an **unchanged candidate** and scope, an evidence-only omission may receive a bounded
supplement from the affected axis. Preserve original complete coverage and outstanding blockers.
Changed source/tests, environment, requirements or rubric invalidate affected evidence; a
narrower review never replaces final whole-spec review. Repairs consume the existing repair
budget and require current-candidate checks and affected-axis review. Never resume a review,
silently retry it or renew its grant. Exhaustion preserves the partial result and returns the
decision to the caller.

Serial verified integration, immutable prerequisites, publication authority and
**human acceptance** remain unchanged. Report usage components, nested usage, task duration and elapsed
time separately. Compact transport is not proof of efficiency, reviewer quality or installed
operation; measuring those needs a separately agreed scenario and budget.
