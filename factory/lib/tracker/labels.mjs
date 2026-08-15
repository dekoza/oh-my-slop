/**
 * The factory's tracker label vocabulary (§3.2) — **fixed constants in code,
 * never configuration**.
 *
 * Per-install label names turn an eligibility predicate into a naming preference
 * and make the tracker graph un-auditable across repos; making them configurable
 * later is purely additive, so the loader refuses `tracker.labels` rather than
 * carrying a knob nothing needs yet.
 *
 * Every string below is dereferenced from here. A label spelled out anywhere else
 * in `factory/` is a second vocabulary waiting to disagree with this one.
 */
export const FACTORY_LABELS = Object.freeze({
	/** §3.1: membership in a run's scope. */
	implementation: "workflow:implement",
	/** §3.2: the claimable half of the eligibility predicate. */
	readyForAgent: "ready-for-agent",
	/** §3.2: visible, blocking its dependents, never touched. */
	readyForHuman: "ready-for-human",
	/** §3.4, §8.9: paused — a human answers in a comment and removes the label. */
	needsHuman: "factory:needs-human",
	/** §8.9: failed — eligibility-excluding, and never auto-requeued (§14.20). */
	failed: "factory:failed",
	/** §7.5, §8.9: published — closes on the human's manual merge. */
	awaitingMerge: "factory:awaiting-merge",
});
