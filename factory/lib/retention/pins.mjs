import { performedEffect, unresolvedEffects } from "../effects/records.mjs";

/**
 * §12.4's pins: **what holds a run in tier 1 past the horizon**.
 *
 * > A run never leaves tier 1 while it has an open PR, a member ticket carrying
 * > `factory:failed` or `factory:needs-human`, or an unresolved effect.
 *
 * Three classes, not four — §12.4 numbers the label pin twice and says so. They
 * are listed here once, and **`cleanup` obeys the same list** (§12.4's
 * unification): a failed attempt's worktree and unpushed branch must survive
 * exactly as long as the evidence explaining them does, so "the run is still in
 * full detail" and "its forensic artifacts still exist" can never disagree.
 *
 * **Every pin is read from durable state.** Expiry runs unattended under the
 * controller lease (§12.6), so a pin that needed a tracker round-trip would fail
 * open the first time Gitea was unreachable — and failing open here deletes
 * evidence. Where durable state cannot answer, the pin **holds**: retaining a
 * run nobody needed costs bytes, and sweeping one somebody did costs the
 * investigation.
 *
 * **A pin is never reachable from configuration** (§14.32) — a pin you can
 * switch off is not a pin. There is no knob in this file and no parameter that
 * disables one.
 */

import { FACTORY_LABELS } from "../tracker/labels.mjs";
import { lastObservedTicket } from "../tracker/observation.mjs";

/** §12.4's three classes, named once. */
export const PINS = Object.freeze({
	openPr: "open-pr",
	attentionLabel: "attention-label",
	unresolvedEffect: "unresolved-effect",
});

/**
 * The two labels §12.4 pins on. They are §8.9's `paused` and `failed` rows read
 * back: both mean a human owes this ticket something, and the evidence has to
 * outlive the asking.
 */
const ATTENTION_LABELS = Object.freeze([FACTORY_LABELS.needsHuman, FACTORY_LABELS.failed]);

/** The dispositions those two labels are applied for (§8.9), as the fallback below reads them. */
const ATTENTION_DISPOSITIONS = Object.freeze({ paused: FACTORY_LABELS.needsHuman, failed: FACTORY_LABELS.failed });

/**
 * Every pin holding this run, or an empty list when nothing does.
 *
 * The answer is a **list rather than a boolean** because the operator's next
 * question is always which one: an open PR is a wait, a label is a person, and
 * an unresolved effect is §12.4's alarm — a run pinned that way for weeks means
 * an effect nothing can settle.
 *
 * **No clock reaches this function.** Every pin is a statement about durable
 * state as it stands, and a pin that consulted the time would be a pin with a
 * horizon of its own — which is precisely what §12.4 makes it *not*: the pins
 * hold a run past the horizon rather than carrying one.
 *
 * @param {object} store an open store, controller or read-only
 * @param {string} run
 * @returns {ReadonlyArray<Readonly<{ pin: string, ticket: number | null, detail: object }>>}
 */
export function pinsForRun(store, run) {
	const pins = [];

	const unresolved = unresolvedEffects(store, { run });
	if (unresolved.length > 0) {
		pins.push(
			pin(PINS.unresolvedEffect, null, {
				unresolved: unresolved.length,
				// The age §12.4's alarm is about is left to `doctor`, which is where
				// the alarm is: a second derivation of it here is a second number that
				// can disagree with the one an operator is reading.
				oldest_requested_at: Math.min(...unresolved.map((effect) => effect.requested_at)),
				effects: Object.freeze(unresolved.map((effect) => effect.effect_key)),
			}),
		);
	}

	for (const execution of store.readTicketExecutions(run)) {
		const observed = lastObservedTicket(store, execution.ticket);

		if (hasOpenPullRequest(store, run, execution.ticket, observed)) {
			pins.push(pin(PINS.openPr, execution.ticket, { ticket_state: observed.state }));
		}

		const labels = attentionLabelsOn(observed, execution.disposition);
		if (labels.length > 0) {
			pins.push(
				pin(PINS.attentionLabel, execution.ticket, {
					labels: Object.freeze(labels),
					// Which of the two answers this is: what the tracker last said, or
					// what this run recorded when nothing has been observed since.
					basis: observed.labels === null ? "disposition" : "observation",
				}),
			);
		}
	}

	return Object.freeze(pins);
}

function pin(name, ticket, detail) {
	return Object.freeze({ pin: name, ticket, detail: Object.freeze(detail) });
}

/**
 * §7.5's pull request, still open.
 *
 * The factory's own record that it opened one is the resolved `pr-create`
 * effect. Whether it is still *open* is read from the ticket, because §7.5's
 * body carries `Closes #N` and **the manual merge is what discharges the
 * ticket** — so a ticket the tracker last reported closed is a PR that has been
 * dealt with. A ticket whose state nothing has observed pins: the PR was opened
 * and no durable record says it stopped being open.
 *
 * **The release channel is the ticket's state, not the pull request's**, and
 * that is a choice with a visible cost: §5.1 polls issues and never pull
 * requests, so a PR *closed unmerged* leaves its ticket open and pins the run
 * indefinitely. The alternative is a tracker read at expiry time, which would
 * put a network call in a pass that must be safe unattended — and the cost of
 * getting this wrong is asymmetric: an over-held run costs bytes an operator can
 * see in `status`, and a swept one costs the investigation.
 */
function hasOpenPullRequest(store, run, ticket, observed) {
	return performedEffect(store, { run, ticket, operation: "pr-create" }) && observed.state !== "closed";
}

/**
 * The attention labels on a member ticket **as durable state last saw them**.
 *
 * §5.1's poll is repository-wide, so a *later* run's observation is what
 * releases this pin: a human clears `factory:failed`, the next run's poll
 * records the new label set, and the old run stops being pinned. That is the
 * only channel — the factory never removes either label itself (§14.20), so
 * without an observation there is nothing that could say the label went away.
 *
 * With no observation at all, the run's own settled disposition answers: §8.9
 * added the label and nothing has since reported otherwise. That direction is
 * deliberate — it pins.
 */
function attentionLabelsOn(observed, disposition) {
	if (observed.labels !== null) return ATTENTION_LABELS.filter((label) => observed.labels.includes(label));

	const label = ATTENTION_DISPOSITIONS[disposition];
	return label === undefined ? [] : [label];
}

