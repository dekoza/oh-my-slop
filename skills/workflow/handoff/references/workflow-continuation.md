# Workflow continuation and closeout

Use at a workflow's completion, pause or fresh-session handoff when an established
larger goal remains. The owning workflow's scope, authority, session and repair limits
still govern. This reference supplies a transition, not permission to cross it.

## Own the remaining work

**Continue** available agent-owned work already authorized within this invocation after
an answer, worker result or successful recovery. Inspect returned evidence before relying
on it. An intermediate artifact or recorded answer is not the requested outcome.

**Pause** at a real human decision, missing authority or input, external blocker,
exhausted budget, required fresh session or explicit user stop. Follow the owning skill's
question format; use `grilling` for human decisions, with options and a recommendation.
A coordinated worker returns the choice and evidence to its caller instead of asking
the human independently. A proposed grant is not existing authority.

**Distinguish** an interrupted attempt from a voluntary stop. Preserve partial state
and reconcile uncertain writes before retrying. A timeout is not completion or a budget
reset. Resume only already authorized work after actual recovery; an explicit user abort
requires clarification before restarting. No indefinite retries or silent model/account
switches follow from this contract.

## Make the boundary actionable

**Report** only the fields needed for the known transition:

- **Completed:** the verified local outcome and its evidence pointer; distinguish local
  completion from the larger remaining goal and any unverified acceptance.
- **Next actor and action:** one responsible owner and the concrete next action, not only
  a skill list or “not authorized” status. Reconcile available facts within scope first.
- **Authority:** existing grants and their durable approval references, exclusions and
  remaining budget; distinguish a proposed authorization from an already approved one.
- **Decision:** ask the actual missing decision now, including a bounded renewal or stop
  choice when the budget is exhausted. Preserve all existing limits pending the answer.

**Supply** a copyable restart prompt immediately when the next action needs a fresh
session, including in the receipt that records a fresh-session approval. Carry:

- Target repository/ticket and the existing workflow to use.
- Durable approval and source/evidence pointers; the exact candidate SHA and source
  bounds where applicable. Reuse adequate unchanged evidence, recheck changed inputs.
- Remaining budget, exclusions, deliverable and stop condition.

Label a prompt requiring new authority as a **proposal**, not a grant. Never put an
unapproved “I authorize…” statement in the human's mouth. A usable prompt may ask only
for bounded preparation until the real authorization is obtained. Keep branch-only
publication, merge, closure, live access and deployment with their existing owners.

**Finish** when the requested outcome is verified complete. Do not manufacture a next
project, compulsory backlog review or approval question when no established goal remains.
A useful handoff is concise; link existing evidence rather than duplicate transcripts.
