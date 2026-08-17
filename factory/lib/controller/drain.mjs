import { MEMBER_CLASSES } from "../tracker/frontier.mjs";

/**
 * §3.5's drain, and the classified per-member report a run exits with.
 *
 * > Scope is drained when nothing is claimable now **and** nothing can become
 * > claimable without external change (a human answer, a manual merge, an
 * > out-of-scope closure). The run then exits with a classified per-member report
 * > and **never lingers polling**.
 *
 * The second clause is the one that needs code. "Nothing claimable now" is a
 * length; "nothing can become claimable without external change" is a question
 * about every blocked member's blockers, which `frontier.mjs` already answers per
 * member as `awaits_external`. This module is what turns those answers into a
 * verdict and a report — it is the thing that knows the run is over, which is why
 * the classification lives there and the mapping lives here.
 *
 * **Never lingering is structural rather than promised.** There is no wait, no
 * timer and no poll in this file or in the loop above it: the scheduler breaks
 * when nothing is claimable and no lane is running, and §3.4's *the run never
 * waits for a human answer* falls out of that with nothing to enforce it. A
 * cleared `factory:needs-human` makes the ticket eligible at the **next** run's
 * first frontier evaluation, as a fresh ticket execution.
 */

/**
 * §3.5's member classes, **exactly** — `closed` · `needs-human` ·
 * `awaiting-merge-dependency` · `blocked-external` · `human-owned` · `failed`.
 *
 * The list is closed and this is the one place it is written down for the report.
 * `frontier.mjs` carries three more because classification happens at every
 * scheduling decision and a mid-run member can be in a state a drained scope
 * cannot; mapping those three onto these six is this file's job.
 */
export const DRAIN_MEMBER_CLASSES = Object.freeze([
	MEMBER_CLASSES.closed,
	MEMBER_CLASSES.needsHuman,
	MEMBER_CLASSES.awaitingMergeDependency,
	MEMBER_CLASSES.blockedExternal,
	MEMBER_CLASSES.humanOwned,
	MEMBER_CLASSES.failed,
]);

/**
 * Is this scope drained?
 *
 * Two conditions, and the report carries both separately because they fail for
 * different reasons and an operator asking "why is this run still going" wants to
 * know which.
 *
 * **A run that never read a frontier gets a third answer, not the first.**
 * `drained: true` over an absent view would be the plausible zero this repository
 * refuses everywhere else — a red preflight, an abandon request already pending,
 * or a loop that never reached a decision would all report the scope as finished
 * on the strength of never having looked at it. `null` is "nobody asked", which
 * is what preflight's `unbuilt` is for the same reason.
 *
 * @param {{ claimable?: readonly number[], members?: readonly object[] } | null} view a
 *   frontier answer, as `readScope` returns it, or `null` if none was read
 * @returns {Readonly<{ drained: boolean | null, read: boolean,
 *                      claimable_now: number | null, movable: readonly number[] }>}
 */
export function drainVerdict(view) {
	if (view === null || view === undefined) {
		return Object.freeze({
			drained: null,
			read: false,
			claimable_now: null,
			movable: Object.freeze([]),
			reason: "no frontier was read, so whether this scope is drained is not a fact this run holds (§3.5).",
		});
	}

	const members = view.members ?? [];
	const claimable = view.claimable ?? [];

	// A member that is blocked by something this run could still close is the
	// scope's own business, not an external change — so it is not drained, even
	// with nothing claimable at this instant.
	const movable = members
		.filter((member) => member.awaits_external === false && !claimable.includes(member.ticket))
		.map((member) => member.ticket);

	return Object.freeze({
		drained: claimable.length === 0 && movable.length === 0,
		read: true,
		claimable_now: claimable.length,
		movable: Object.freeze(movable),
	});
}

/**
 * The classified per-member report (§3.5), plus what this run did to each member.
 *
 * @param {object} report
 * @param {object | null} [report.view] the last frontier answer the loop read
 * @param {object | null} [report.executed] the scheduler's own result
 * @param {readonly object[]} [report.inFlight] durable ticket executions with no disposition
 * @param {string | null} [report.missing] the subsystem that would have found work
 * @returns {Readonly<object>}
 */
export function drainReport({ view = null, executed = null, inFlight = [], missing = null } = {}) {
	const verdict = drainVerdict(view);
	const lanes = new Map((executed?.lanes ?? []).map((lane) => [lane.ticket, lane]));
	// #154: the tickets §9's exhaustion memo held at the loop's last decision.
	// They are claimable on the tracker and unspendable by the run, and the
	// report says so in one of the six classes rather than hiding them in a
	// count — the operator's question is *why* the run stopped.
	const exhausted = new Map((executed?.exhausted ?? []).map((entry) => [entry.ticket, entry]));
	const members = (view?.members ?? []).map((member) =>
		reportedMember(member, view, lanes.get(member.ticket), exhausted.get(member.ticket)),
	);

	return Object.freeze({
		claimed: claimsMade(executed),
		lanes_run: executed?.lanes_run ?? 0,
		members: Object.freeze(members),
		counts: countByClass(members),
		in_flight: inFlight.length,
		released: executed?.released ?? 0,
		refused: executed?.refused ?? [],
		blocked: executed?.blocked ?? [],
		drained: verdict.drained,
		drain: verdict,
		/**
		 * §7.6: the report **may note** Gitea's unmergeable flag, and **no
		 * automation acts on it in v1**. It is carried through from the member the
		 * frontier answered with and read back by nothing — `drainVerdict` above
		 * does not consult it, so a conflicted PR cannot change what the run does.
		 * A PR that turned conflicted before a manual merge is the human's call.
		 *
		 * Nothing sets it yet, and there is no seam here for setting it: the flag
		 * lives on the pull request, and discovering the open factory PR from its
		 * parseable body is §7.5's (#107). A pass-through is the whole of what this
		 * slice can honestly own — a hook nothing calls would be the speculative
		 * half of the same idea.
		 */
		unmergeable: Object.freeze({
			noted: members.filter((member) => member.unmergeable === true).map((member) => member.ticket),
			acted_on: false,
			discovered_by: "§7.5's PR discovery, which has not landed (#107)",
			spec: "§7.6",
		}),
		...(missing === null ? {} : { missing }),
		spec: "§3.2, §3.5, §9",
	});
}

/**
 * How many tickets this run actually claimed.
 *
 * **A lane that ran is not a ticket claimed.** §3.3 has four ways for a lane to
 * find the ticket is not its own — a human's assignee, a live claim, a foreign
 * claim inside its window, a lower claim-comment id — and each of them ends the
 * lane having written nothing to the tracker. Counting those would report a run
 * that touched nothing as having claimed a ticket, which is §9.7's green-looking
 * run that did nothing, stated as a number.
 *
 * A lane that reports no claim at all is a caller-supplied executor that does not
 * model claiming; it is counted as having run, which is what `lanes_run` meant
 * before there was a claim to distinguish.
 */
function claimsMade(executed) {
	return (executed?.lanes ?? []).filter((lane) => lane.outcome?.claimed !== false).length;
}

/**
 * One member, in §3.5's vocabulary.
 *
 * The mapping is not a rename. Three of §3.5's six are facts about the member
 * itself — `closed`, `failed`, `human-owned` — and two are facts about what it is
 * *waiting on*: `awaiting-merge-dependency` and `blocked-external` both name a
 * dependency rather than a state of the ticket. That is why a member blocked by
 * an in-scope blocker takes **its blocker's** class: at drain every open in-scope
 * blocker is itself settled, so the class the dependent inherits is the reason a
 * human has to act, and `blocked_by` names where to act.
 *
 * `ineligible` maps to `human-owned` for the same reason §3.2 reports a
 * `ready-for-human` member that way: it is visible, it blocks its dependents, and
 * only a human adding the missing label changes that. `frontier_class` is kept
 * beside the mapped one so nothing the classifier knew is lost in the mapping.
 */
function reportedMember(member, view, lane, exhaustedEntry) {
	const mapped =
		exhaustedEntry !== undefined
			? exhaustionBlock(member, exhaustedEntry)
			: mapClass(member, view, new Set(), lane);

	return Object.freeze({
		ticket: member.ticket,
		class: mapped.class,
		reason: mapped.reason ?? member.reason ?? null,
		frontier_class: classOf(member, view),
		blocked_by: mapped.blockedBy ?? null,
		awaits_external: member.awaits_external === true,
		title: member.title,
		state: member.state,
		labels: member.labels,
		html_url: member.html_url,
		// What this run did about it, when it got that far. A member the run never
		// reached carries `null` rather than a plausible disposition.
		disposition: lane?.disposition ?? null,
		...(lane?.error === undefined || lane?.error === null
			? {}
			: { failure: { reason: lane.error.reason ?? null, message: lane.error.message } }),
		// §7.6, carried through. `null` is *not discovered* rather than *mergeable*.
		unmergeable: typeof member.unmergeable === "boolean" ? member.unmergeable : null,
	});
}

/**
 * #154: a member the tracker calls claimable but §9's exhaustion memo will not
 * let the run spend. It lands in `blocked-external` — the one of §3.5's six
 * meaning *something outside this run has to move first* — and the reason
 * carries what the class alone cannot: which resource class refused, and the
 * expiry a probe must settle before dispatch touches it again. No seventh
 * member class is invented for it: the closed six hold, and the sentence does
 * the rest.
 */
function exhaustionBlock(member, exhaustedEntry) {
	const until =
		exhaustedEntry.until === null
			? "no expiry is recorded, so only a probe can settle it"
			: `until ${new Date(exhaustedEntry.until).toISOString()}`;
	return {
		class: MEMBER_CLASSES.blockedExternal,
		reason:
			`#${member.ticket} is claimable, but its resource class "${exhaustedEntry.class}" is provider-exhausted ${until} (§9). ` +
			"The provider refused for quota or rate reasons; dispatch holds until the memo expires and a probe re-admits the class.",
		blockedBy: null,
	};
}

function mapClass(member, view, seen = new Set(), lane = undefined) {
	const frontierClass = classOf(member, view);
	if (DRAIN_MEMBER_CLASSES.includes(frontierClass)) return { class: frontierClass };

	if (frontierClass === MEMBER_CLASSES.ineligible) {
		return { class: MEMBER_CLASSES.humanOwned };
	}

	// `claimable` at drain is a contradiction §3.5 does not have a word for, and
	// inventing one would put a seventh member in a six-member list. `human-owned`
	// is where it lands because it is the one of the six meaning *visible,
	// unclaimable, and only a human changes that* — but §3.2 defines it by the
	// `ready-for-human` label, so the class alone would be misleading and the
	// reason has to carry the rest.
	//
	// **The lane is what makes that reason true.** A member left claimable because
	// a human holds the assignee is genuinely human-owned; one left claimable
	// because the operator stopped the run is not, and saying so is the difference
	// between an operator going to look at the ticket and going to look at the run.
	if (frontierClass === MEMBER_CLASSES.claimable) {
		return { class: MEMBER_CLASSES.humanOwned, reason: whyStillClaimable(member, lane) };
	}

	// A frontier answer that classified nothing. `readScope` always does, so this
	// is a caller-supplied selector — and the report says it could not tell rather
	// than picking whichever of the six looks plausible.
	if (frontierClass === null) {
		return {
			class: MEMBER_CLASSES.humanOwned,
			reason: `#${member.ticket} came back from a frontier that carried no classification, so this run cannot say why it is not claimable (§3.5).`,
		};
	}

	// `blocked`: an in-scope open blocker. Take the class of the blocker that will
	// not move — lowest ticket number first, so the answer is stable across runs.
	//
	// `seen` is not defensive tidiness: Gitea's dependency graph is not checked for
	// cycles, and two tickets each declared blocked by the other would otherwise
	// walk forever inside a report the operator is reading to find out *why* the
	// run stopped.
	const byTicket = new Map((view?.members ?? []).map((other) => [other.ticket, other]));
	const open = (member.blockers ?? [])
		.filter((blocker) => !blocker.satisfied)
		.sort((left, right) => left.ticket - right.ticket);
	const root = open
		.map((blocker) => byTicket.get(blocker.ticket))
		.find((blocker) => blocker !== undefined && !seen.has(blocker.ticket));

	if (root === undefined) {
		// §3.1 defines `blocked-external` as an open blocker **outside scope**, and a
		// cycle's blockers are inside it — so the class is a stretch and the reason
		// says which case it is. §3.5's six have no word for a cycle, and inventing
		// a seventh to describe a tracker graph nobody validated would be worse than
		// naming the shape in the sentence an operator actually reads.
		const cycle = open.length > 0 && open.every((blocker) => byTicket.has(blocker.ticket));
		return {
			class: MEMBER_CLASSES.blockedExternal,
			reason:
				open.length === 0
					? `#${member.ticket} is blocked, and the blocker is not in this run's scope (§3.1).`
					: cycle
						? `#${member.ticket} is in a dependency cycle with ${open.map((blocker) => `#${blocker.ticket}`).join(", ")}; every blocker is in scope, and no ordering of them exists, so a human has to remove an edge (§3.2).`
						: `#${member.ticket} is blocked by ${open.map((blocker) => `#${blocker.ticket}`).join(", ")}, outside this run's scope; scope never auto-expands (§3.1).`,
			blockedBy: open[0]?.ticket ?? null,
		};
	}

	const inherited = mapClass(root, view, new Set([...seen, member.ticket]));
	return {
		class: inherited.class,
		reason: `#${member.ticket} is blocked by #${root.ticket}, which is ${inherited.class}: ${inherited.reason ?? root.reason ?? `#${root.ticket} is ${inherited.class}.`}`,
		blockedBy: root.ticket,
	};
}

/**
 * Why a member the frontier still calls claimable is in the report at all.
 *
 * A lane that ran and declined knows the answer exactly — §3.3's claim outcome is
 * the reason, and every one of its four refusing values names a different person
 * to go and talk to. Without a lane the run never reached the ticket, and saying
 * *that* is the honest answer rather than implying anybody owns it.
 */
function whyStillClaimable(member, lane) {
	const claim = lane?.outcome?.claim ?? null;
	if (claim !== null && typeof claim.reason === "string") {
		return `#${member.ticket} is still claimable, and this run did not take it: ${claim.reason}`;
	}

	return `#${member.ticket} was still claimable when the run ended and this run never reached it; the scope did not drain (§3.5).`;
}

/**
 * The class the frontier gave this member, or the one its own answer implies.
 *
 * `readScope` classifies every member, so the fallback is for a caller-supplied
 * selector: a member the answer listed as claimable **is** claimable, and that
 * much is readable from the answer itself. Anything else is `null` — an absence
 * this file reports rather than fills in.
 */
function classOf(member, view) {
	if (typeof member.class === "string") return member.class;
	return (view?.claimable ?? []).includes(member.ticket) ? MEMBER_CLASSES.claimable : null;
}

/** Every one of §3.5's six, including the zeros: a class nothing is in is an answer. */
function countByClass(members) {
	const counts = Object.fromEntries(DRAIN_MEMBER_CLASSES.map((name) => [name, 0]));
	for (const member of members) counts[member.class] += 1;
	return Object.freeze(counts);
}
