import { isScope, SCOPE_FORMS } from "../controller/scope.mjs";
import { FactoryTrackerError } from "./errors.mjs";
import { readEach } from "./gitea.mjs";
import { FACTORY_LABELS } from "./labels.mjs";
import { isMemberOf } from "./membership.mjs";

/**
 * §3.1's scope resolution and §3.2's eligibility, over the **live** tracker
 * graph.
 *
 * > A run is a live selector over the tracker graph, never a pinned copy.
 *
 * So this module holds no state between calls and caches nothing. Every
 * `readScope` is a fresh set of reads, which is what makes "membership is
 * recomputed at every scheduling decision" a property of the code rather than a
 * discipline the scheduler has to keep. A direct-ticket set is pinned by
 * definition — the numbers were typed — and even then the states behind those
 * numbers are read again every time.
 *
 * **Scope never auto-expands.** A blocker outside the scope is read, so its
 * state can be known, but it never becomes a member: an *open* one marks its
 * dependent `blocked-external`, and widening is an operator's decision.
 */

/**
 * How a member stands right now.
 *
 * §3.5 names six classes for the drain report, and all six are here. Three more
 * exist because classification happens at **every** scheduling decision rather
 * than only at drain, and a mid-run member can be in a state a drained scope
 * cannot:
 *
 * - `claimable` — the frontier itself, which by definition is empty at drain;
 * - `blocked` — waiting on an in-scope blocker. Whether the run can still *do*
 *   anything about that blocker is a separate question, and the member carries
 *   `awaits_external` for it: a blocker that is itself `human-owned`,
 *   `needs-human` or `failed` will not close on its own, so a scope whose only
 *   blocked members await one **is** drained (§3.5) however the class reads;
 * - `ineligible` — without the labels §3.2's predicate requires. Usually a
 *   direct-ticket set the operator typed, but a parent-scoped member reaches it
 *   too: the label that found it is `workflow:implement`, and `ready-for-agent`
 *   can still be absent.
 *
 * Mapping these onto §3.5's six for the drain report belongs to the drain
 * report (#102): it is the thing that knows the run is over.
 */
export const MEMBER_CLASSES = Object.freeze({
	claimable: "claimable",
	blocked: "blocked",
	blockedExternal: "blocked-external",
	awaitingMergeDependency: "awaiting-merge-dependency",
	needsHuman: "needs-human",
	humanOwned: "human-owned",
	failed: "failed",
	closed: "closed",
	ineligible: "ineligible",
});

/**
 * §3.4 and §7.6: **the frontier query simply excludes these labels.**
 *
 * Resume is mechanical — the human answers and removes the label — so the
 * factory never has to decide whether a comment was an answer. `awaiting-merge`
 * is the same shape one phase later: the ticket closes when a human merges, and
 * until then nothing here touches it.
 */
export const FRONTIER_EXCLUDED_LABELS = Object.freeze([FACTORY_LABELS.needsHuman, FACTORY_LABELS.awaitingMerge]);

/**
 * §3.2's four-term predicate: **open ∧ `workflow:implement` ∧ `ready-for-agent`
 * ∧ in scope.** The caller supplies the fourth term, because "in scope" is a
 * fact about the run and not about the ticket.
 *
 * The exclusions are the rest of §3.2 and §3.4 read together. `ready-for-human`
 * is among them even though §3.2 states the predicate without it: a ticket
 * carrying *both* human labels is contradictory, and an exported predicate that
 * answered `true` for one would be a trap for every later caller. §3.2 is
 * unambiguous that such a member is never touched, so the predicate says so.
 *
 * @param {{ state: string, labels: readonly string[] }} issue
 * @returns {boolean}
 */
export function isEligible(issue) {
	return (
		issue.state === "open" &&
		issue.labels.includes(FACTORY_LABELS.implementation) &&
		issue.labels.includes(FACTORY_LABELS.readyForAgent) &&
		!issue.labels.includes(FACTORY_LABELS.readyForHuman) &&
		!FRONTIER_EXCLUDED_LABELS.some((label) => issue.labels.includes(label))
	);
}

/**
 * A blocking edge is satisfied **only** by the blocker being closed (§3.2). No
 * stacked-branch softening: a serial run may stall on manual merges, and the
 * drain report says so rather than the scheduler pretending a pushed branch is
 * a closed ticket.
 *
 * @param {{ state: string }} blocker
 * @returns {boolean}
 */
export function edgeSatisfied(blocker) {
	return blocker.state === "closed";
}

/**
 * Resolve a run's scope over the live graph and classify every member.
 *
 * **The edge set is an input, not something this always fetches.** §5.1 is
 * explicit that `dependencies`/`blocks` are read *only* on an `add_dependency`,
 * and this function runs at every scheduling decision — so one edge read per
 * member per decision would be exactly the cost that clause exists to prevent.
 * A caller already maintaining the graph from the observation poll passes it
 * here; a caller with nothing to pass — an operator typing `doctor #42` once —
 * omits it, and then only the members an edge could actually reclassify are
 * asked.
 *
 * @param {object} reader a `createGiteaReader` client
 * @param {object} scope §3.1's selector, from `controller/scope.mjs`
 * @param {{ at?: number, edges?: Map<number, object[]> | null }} [options] `edges`
 *   maps a ticket to the issues blocking it, as `reader.dependencies` returns them
 * @returns {Promise<Readonly<object>>} the one value both the report and the
 *   scheduler read: members classified, and the claimable ones in order
 * @throws {FactoryTrackerError} `scope-unrecognised`
 */
export async function readScope(reader, scope, { at = Date.now(), edges = null } = {}) {
	// §3.1 has exactly two forms and never a third. `parseScope` produces only
	// those two, but this is exported and the scheduler calls it — and a shape
	// nobody recognises would otherwise be treated as a direct-ticket set below.
	if (!isScope(scope)) {
		throw new FactoryTrackerError(
			"scope-unrecognised",
			`${JSON.stringify(scope ?? null)} is not one of §3.1's two scope forms; a scope decision made on a shape nobody recognises is worse than a refusal.`,
			{ at: "scope", found: scope ?? null, expected: Object.values(SCOPE_FORMS).join("|") },
		);
	}

	const members = await resolveMembers(reader, scope);
	const inScope = new Set(members.map((member) => member.number));

	// **Only the members whose class an edge could change.** `decide` below reaches
	// for blockers exactly once — after the state and label checks have all passed —
	// so a closed, failed, paused, awaiting-merge, human-owned or ineligible member
	// is classified without them, and reading its edges buys nothing.
	//
	// This is the honest half of §5.1's "only on an `add_dependency`" that a caller
	// with no observation poll can keep. It cannot know *when* the graph changed,
	// so it re-reads rather than caching a graph that would silently freeze; what
	// it can do is not ask about tickets whose answer it will not use. On a scope
	// that is mostly settled — which is what a scope looks like by the time it
	// drains — that is most of the reads.
	const needEdges = edges === null ? members.filter((member) => isEligible(member)) : [];
	const blockers =
		edges ??
		new Map(
			await readEach(needEdges, async (member) => [member.number, await reader.dependencies(member.number)]),
		);

	const classified = awaitingExternal(
		members.map((member) => classify(member, blockers.get(member.number) ?? [], inScope)),
	).sort((a, b) => a.ticket - b.ticket);

	return Object.freeze({
		scope,
		resolved_at: at,
		members: Object.freeze(classified),
		// §3.2's ordering: **ascending issue number**, and nothing else. Dependency
		// order is already enforced by claimability, and there are no priority
		// labels in v1 — so the sort above is the whole of it.
		claimable: Object.freeze(
			classified.filter((member) => member.class === MEMBER_CLASSES.claimable).map((member) => member.ticket),
		),
		counts: countByClass(classified),
	});
}

/**
 * §3.1's two forms, and no third.
 *
 * Parent-scoped candidates come from the **label, server-side**, and membership
 * is then the literal `Part of #N` first line. The state filter is `all`
 * because a closed member is still a member — §3.5 classes it `closed`, and a
 * scope that dropped its finished tickets would report a shrinking membership
 * to a monitor that derives structure from it (§3.1).
 */
async function resolveMembers(reader, scope) {
	if (scope.kind === SCOPE_FORMS.parent) {
		const candidates = await reader.listIssues({
			labels: [FACTORY_LABELS.implementation],
			state: "all",
		});
		return candidates.filter((issue) => isMemberOf(issue.body, scope.parent));
	}

	// Read individually rather than filtered from a list: the operator named
	// these numbers, and a number that is not there must be an error about that
	// number rather than a member that quietly went missing.
	return readEach(scope.tickets, (ticket) => reader.readIssue(ticket));
}

/**
 * §3.5's second clause, answered per member: *nothing can become claimable
 * without external change.*
 *
 * A `blocked` member is waiting on an in-scope blocker — but whether the run can
 * still do anything about that blocker depends on the blocker's own class. One
 * that is `human-owned`, `needs-human`, `failed`, or itself awaiting a merge
 * will not close on its own, so its dependent is waiting on a human exactly as
 * surely as if it were blocked from outside the scope.
 *
 * It is a **field rather than a ninth class**, because §3.5's vocabulary is
 * closed and inventing "blocked by something that will never move" would put a
 * seventh member in a six-member list. The drain report (#102) is what turns
 * this into a verdict; the classifier's job is to have looked.
 */
function awaitingExternal(members) {
	const byTicket = new Map(members.map((member) => [member.ticket, member]));
	const settled = new Set([
		MEMBER_CLASSES.humanOwned,
		MEMBER_CLASSES.needsHuman,
		MEMBER_CLASSES.failed,
		MEMBER_CLASSES.awaitingMergeDependency,
		MEMBER_CLASSES.blockedExternal,
		MEMBER_CLASSES.ineligible,
	]);

	return members.map((member) => {
		if (member.class !== MEMBER_CLASSES.blocked) return member;

		// Every open blocker is in scope — an out-of-scope one would have made this
		// `blocked-external` already — so each has a class of its own to consult.
		const open = member.blockers.filter((blocker) => !blocker.satisfied);
		const movable = open.some((blocker) => !settled.has(byTicket.get(blocker.ticket)?.class));

		return Object.freeze({ ...member, awaits_external: !movable });
	});
}

/**
 * The classification, in one place and in one order.
 *
 * The order runs from **the member's own state** to **what it is waiting on**,
 * because a member's labels are what a human changes and its blocking edges are
 * downstream of somebody else's. A ticket that is both `ready-for-human` and
 * blocked is reported human-owned: telling the operator to go close its blocker
 * would be advice about a ticket the factory may never touch anyway.
 */
function classify(member, rawBlockers, inScope) {
	const blockers = rawBlockers.map((blocker) =>
		Object.freeze({
			ticket: blocker.number,
			state: blocker.state,
			in_scope: inScope.has(blocker.number),
			satisfied: edgeSatisfied(blocker),
			awaiting_merge: blocker.labels.includes(FACTORY_LABELS.awaitingMerge),
		}),
	);

	const decided = decide(member, blockers);

	return Object.freeze({
		ticket: member.number,
		title: member.title,
		state: member.state,
		class: decided.class,
		reason: decided.reason,
		// §3.2: human-owned members are **visible but unclaimable** — reported,
		// blocking their dependents, never touched.
		claimable: decided.class === MEMBER_CLASSES.claimable,
		// Set by `awaitingExternal` for the one class where it is a question. Every
		// other class already answers it: a `claimable` member is the run's to take,
		// and the rest are waiting on a human by definition.
		awaits_external: decided.class !== MEMBER_CLASSES.claimable,
		labels: member.labels,
		// Read and reported, never acted on here: §3.3's "any assignee the factory
		// did not set is an absolute human claim" is arbitrated at claim time,
		// against the factory's own effect record, by the slice that claims (#102).
		assignees: member.assignees,
		blockers: Object.freeze(blockers),
		content_version: member.content_version,
		updated_at: member.updated_at,
		html_url: member.html_url,
	});
}

function decide(member, blockers) {
	if (member.state !== "open") {
		return { class: MEMBER_CLASSES.closed, reason: `#${member.number} is ${member.state}.` };
	}

	if (member.labels.includes(FACTORY_LABELS.failed)) {
		return {
			class: MEMBER_CLASSES.failed,
			reason: `#${member.number} carries ${FACTORY_LABELS.failed}; a human removing the label is what requeues it (§8.9).`,
		};
	}

	if (member.labels.includes(FACTORY_LABELS.needsHuman)) {
		return {
			class: MEMBER_CLASSES.needsHuman,
			reason: `#${member.number} carries ${FACTORY_LABELS.needsHuman}; resume is the human answering and removing the label (§3.4).`,
		};
	}

	if (member.labels.includes(FACTORY_LABELS.awaitingMerge)) {
		return {
			class: MEMBER_CLASSES.awaitingMergeDependency,
			reason: `#${member.number} carries ${FACTORY_LABELS.awaitingMerge}; it closes on the human's manual merge (§7.6).`,
		};
	}

	if (member.labels.includes(FACTORY_LABELS.readyForHuman)) {
		return {
			class: MEMBER_CLASSES.humanOwned,
			reason: `#${member.number} carries ${FACTORY_LABELS.readyForHuman}; it is visible, it blocks its dependents, and the factory never touches it (§3.2).`,
		};
	}

	if (!isEligible(member)) {
		const missing = [FACTORY_LABELS.implementation, FACTORY_LABELS.readyForAgent].filter(
			(label) => !member.labels.includes(label),
		);
		return {
			class: MEMBER_CLASSES.ineligible,
			reason: `#${member.number} is missing ${missing.join(" and ")}; §3.2's predicate is open ∧ ${FACTORY_LABELS.implementation} ∧ ${FACTORY_LABELS.readyForAgent} ∧ in scope.`,
		};
	}

	const open = blockers.filter((blocker) => !blocker.satisfied);
	if (open.length === 0) {
		return { class: MEMBER_CLASSES.claimable, reason: `#${member.number} is eligible and every blocker is closed.` };
	}

	const external = open.filter((blocker) => !blocker.in_scope);
	if (external.length > 0) {
		return {
			class: MEMBER_CLASSES.blockedExternal,
			reason: `#${member.number} is blocked by ${list(external)}, outside this run's scope; scope never auto-expands (§3.1).`,
		};
	}

	const awaitingMerge = open.filter((blocker) => blocker.awaiting_merge);
	if (awaitingMerge.length > 0) {
		return {
			class: MEMBER_CLASSES.awaitingMergeDependency,
			reason: `#${member.number} is blocked by ${list(awaitingMerge)}, awaiting a human's manual merge (§7.6).`,
		};
	}

	return {
		class: MEMBER_CLASSES.blocked,
		reason: `#${member.number} is blocked by ${list(open)}; a blocking edge is satisfied only by the blocker being closed (§3.2).`,
	};
}

function list(blockers) {
	return blockers.map((blocker) => `#${blocker.ticket}`).join(", ");
}

/** Every class, including the zeros: a class nothing is in is an answer too. */
function countByClass(members) {
	const counts = Object.fromEntries(Object.values(MEMBER_CLASSES).map((name) => [name, 0]));
	for (const member of members) counts[member.class] += 1;
	return Object.freeze(counts);
}
