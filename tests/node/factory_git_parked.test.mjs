import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

import { createAttemptWorktree } from "../../factory/lib/git/attempt.mjs";
import { SOURCE_GIT_LOCAL } from "../../factory/lib/effects/catalogue.mjs";
import { readAttemptBranches, unreadableAttemptBranches } from "../../factory/lib/git/parked.mjs";
import { mintedAttemptBranches } from "../../factory/lib/worker/attempt.mjs";
import { commitInto, mintedAttempt, TEST_HOLD } from "./helpers/factory-git.mjs";
import { FIXED_NOW } from "./helpers/factory-store.mjs";

/**
 * #151: an attempt that ends without an outbox still leaves a branch behind, and
 * that branch routinely carries real commits. §5.2 makes git — not the worker's
 * claim and not the journal's intent — authoritative for what a ref is at, so the
 * head is read from the clone at settlement time.
 */

const TICKET = 114;

async function ticketExecution(t) {
	const fixture = await mintedAttempt(t, { ticket: TICKET });
	return { ...fixture, git: (...args) => execFileSync("git", ["-C", fixture.clone.dir, ...args], { encoding: "utf8" }).trim() };
}

/**
 * One more attempt of the same ticket execution: the mint §6.5 writes, carrying
 * the base §7.2 pinned, and the branch and worktree §7.3 opens at it.
 */
async function attemptAt(fixture, ordinal, baseCommit, { role = "implement" } = {}) {
	const attempt = `${fixture.run}-t${TICKET}-a${ordinal}`;
	if (ordinal > 1) fixture.store.append(launched(fixture.run, attempt, baseCommit, role));
	const created = await createAttemptWorktree(fixture.store, fixture.clone, {
		hold: TEST_HOLD,
		run: fixture.run,
		ticket: TICKET,
		attempt,
		phase: "implement",
		baseCommit,
		workerConfig: fixture.workerConfig,
		actor: "controller",
		at: FIXED_NOW,
	});
	return { attempt, ...created };
}

/**
 * The composition every caller makes: identities from the journal (§5.2's intent),
 * the refs themselves from git (§5.2's fact).
 */
function readParked(fixture) {
	return readAttemptBranches(fixture.clone, mintedAttemptBranches(fixture.store, { run: fixture.run, ticket: TICKET }));
}

/** §6.5's mint, as the journal holds it — the base commit included (§7.2). */
function launched(run, attempt, baseCommit, role = "implement", { ticket = TICKET, extra = {} } = {}) {
	return {
		kind: "attempt.launched",
		source: "controller",
		run,
		ticket,
		phase: "implement",
		attempt,
		occurredAt: FIXED_NOW,
		observedAt: FIXED_NOW,
		payload: { role, profile: "builder", base_commit: baseCommit, ...extra },
	};
}

test("§5.2: an unharvested attempt's head is read from the clone, never from what the journal recorded at mint", async (t) => {
	const fixture = await ticketExecution(t);
	const second = await attemptAt(fixture, 2, fixture.base.commit);
	const head = commitInto(second.worktreePath, { "work.txt": "a timed-out worker still committed\n" }, {
		message: "feat: the work nobody harvested",
		trailer: null,
	});

	const read = await readParked(fixture);
	const entry = read.branches.find((branch) => branch.attempt === second.attempt);

	assert.equal(read.source, SOURCE_GIT_LOCAL);
	assert.equal(entry.branch, second.branch);
	// The mint recorded the base as this attempt's `sha`; the head is the commit
	// the worker made after it, which is exactly the fact the journal cannot know.
	assert.equal(entry.head, head);
	assert.notEqual(entry.head, entry.base_commit);
	assert.equal(entry.base_commit, fixture.base.commit);
	assert.equal(entry.commits_ahead, 1);
	assert.equal(entry.unreadable, null);
});

test("an attempt that committed nothing records that plainly, rather than as an absence (#151, §11.2)", async (t) => {
	const fixture = await ticketExecution(t);
	const second = await attemptAt(fixture, 2, fixture.base.commit);

	const read = await readParked(fixture);
	const entry = read.branches.find((branch) => branch.attempt === second.attempt);

	// The branch exists and is at the base: "nothing was built" is a read, not a
	// missing field a reader has to interpret.
	assert.equal(entry.head, fixture.base.commit);
	assert.equal(entry.commits_ahead, 0);
	assert.equal(entry.unreadable, null);
});

test("each attempt is measured against its own base, so a repair is not credited with the work it branched from (§7.4)", async (t) => {
	const fixture = await ticketExecution(t);
	const failed = await attemptAt(fixture, 2, fixture.base.commit);
	const parked = commitInto(failed.worktreePath, { "wave.txt": "the first wave\n" }, {
		message: "feat: a wave",
		trailer: null,
	});
	// §8.5: a repair branches from the prior attempt's tip.
	const repair = await attemptAt(fixture, 3, parked);
	commitInto(repair.worktreePath, { "wave.txt": "the second wave\n" }, { message: "fix: the repair", trailer: null });

	const read = await readParked(fixture);
	const byAttempt = new Map(read.branches.map((branch) => [branch.attempt, branch]));

	assert.equal(byAttempt.get(failed.attempt).commits_ahead, 1);
	// One, not two: measured against the run's base it would be credited with the
	// wave the attempt before it made.
	assert.equal(byAttempt.get(repair.attempt).commits_ahead, 1);
	assert.equal(byAttempt.get(repair.attempt).base_commit, parked);
});

test("every attempt of the ticket execution is read, in the order it was minted, with the role it ran", async (t) => {
	const fixture = await ticketExecution(t);
	await attemptAt(fixture, 2, fixture.base.commit);
	await attemptAt(fixture, 3, fixture.base.commit, { role: "review-standards" });

	const read = await readParked(fixture);

	assert.deepEqual(
		read.branches.map((branch) => [branch.attempt.slice(-2), branch.role]),
		[
			["a1", "implement"],
			["a2", "implement"],
			["a3", "review-standards"],
		],
	);
});

test("a branch the clone no longer holds reads as absent, which is not the same fact as uncountable (§12.8)", async (t) => {
	const fixture = await ticketExecution(t);
	const second = await attemptAt(fixture, 2, fixture.base.commit);
	commitInto(second.worktreePath, { "work.txt": "published, then swept\n" }, { message: "feat: work", trailer: null });
	// §12.8 makes a published attempt's local branch cleanup-eligible, so this is a
	// state the factory creates on purpose.
	fixture.git("worktree", "remove", "--force", second.worktreePath);
	fixture.git("branch", "--delete", "--force", second.branch);

	const read = await readParked(fixture);
	const entry = read.branches.find((branch) => branch.attempt === second.attempt);

	assert.equal(entry.head, null);
	assert.equal(entry.commits_ahead, null);
	// Absent, not unanswerable: git answered, and what it said was "no such ref".
	assert.equal(entry.unreadable, null);
});

test("a git refusal is carried per attempt rather than swallowed or thrown at a settlement (§11.2)", async (t) => {
	const fixture = await ticketExecution(t);
	const second = await attemptAt(fixture, 2, fixture.base.commit);
	commitInto(second.worktreePath, { "work.txt": "committed\n" }, { message: "feat: work", trailer: null });
	// A base commit the clone does not have: the ref is readable and the count is
	// not, which is two facts and never one.
	const minted = mintedAttemptBranches(fixture.store, { run: fixture.run, ticket: TICKET }).map((record) =>
		record.attempt === second.attempt ? { ...record, baseCommit: "0".repeat(40) } : record,
	);

	const read = await readAttemptBranches(fixture.clone, minted);
	const entry = read.branches.find((branch) => branch.attempt === second.attempt);

	assert.notEqual(entry.head, null);
	assert.equal(entry.commits_ahead, null);
	assert.match(entry.unreadable, /rev-list|bad revision|unknown revision|not in the working tree/i);
});

test("a mint that recorded no base commit is uncountable, never silently zero (§11.2)", async (t) => {
	// The fixture's first attempt is appended by the test helper, which records no
	// base commit — the shape an older journal has. Its branch is real, so the only
	// thing missing is what to count against.
	const fixture = await ticketExecution(t);
	await attemptAt(fixture, 1, fixture.base.commit);

	const minted = mintedAttemptBranches(fixture.store, { run: fixture.run, ticket: TICKET });
	const read = await readAttemptBranches(fixture.clone, minted);
	const entry = read.branches.find((branch) => branch.attempt === fixture.attempt);

	assert.equal(entry.head, fixture.base.commit);
	assert.equal(entry.base_commit, null);
	assert.equal(entry.commits_ahead, null);
	assert.match(entry.unreadable, /base commit/i);
});

test("another ticket's attempts are never in this ticket execution's read", async (t) => {
	const fixture = await ticketExecution(t);
	fixture.store.append(launched(fixture.run, `${fixture.run}-t999-a1`, fixture.base.commit, "implement", { ticket: 999 }));

	const minted = mintedAttemptBranches(fixture.store, { run: fixture.run, ticket: TICKET });

	assert.deepEqual(
		minted.map((record) => record.attempt),
		[fixture.attempt],
	);
});

test("the branch is derived from the identity, so a journal payload cannot point the read at another ref (§7.3, §5.2)", async (t) => {
	const fixture = await ticketExecution(t);
	const attempt = `${fixture.run}-t${TICKET}-a2`;
	fixture.store.append(
		launched(fixture.run, attempt, fixture.base.commit, "implement", { extra: { branch: "factory/t1/somebody-elses" } }),
	);

	const minted = mintedAttemptBranches(fixture.store, { run: fixture.run, ticket: TICKET });

	assert.equal(minted.at(-1).branch, `factory/t${TICKET}/a${attempt}`);
});

test("reading nothing is an empty list, and a read with no clone call cannot fail", async (t) => {
	const fixture = await ticketExecution(t);

	const read = await readAttemptBranches(fixture.clone, []);

	assert.deepEqual(read, { source: SOURCE_GIT_LOCAL, branches: [], unreadable: null });
});

test("a count git answered with something that is not a number is uncountable, never NaN (§11.2)", async (t) => {
	const fixture = await ticketExecution(t);
	const second = await attemptAt(fixture, 2, fixture.base.commit);
	const minted = mintedAttemptBranches(fixture.store, { run: fixture.run, ticket: TICKET });
	// The one answer a caller cannot check for itself: `rev-list --count` promises
	// one integer, and a reader that took the promise on trust would render `NaN`
	// commits and, worse, read it as "not ahead".
	const babbling = {
		...fixture.clone,
		git: (args, options) => (args[0] === "rev-list" ? Promise.resolve("plenty") : fixture.clone.git(args, options)),
	};

	const read = await readAttemptBranches(babbling, minted);
	const entry = read.branches.find((branch) => branch.attempt === second.attempt);

	assert.equal(entry.commits_ahead, null);
	assert.match(entry.unreadable, /not a count/);
});

test("a read that could not even list the attempts is its own answer, not an empty list (#151, §11.2)", async () => {
	const refused = unreadableAttemptBranches("the journal named an attempt of another ticket");

	// Three answers a reader must tell apart: `null` for nobody looked, this for
	// looked and could not, and an empty `branches` for looked and there are none.
	assert.deepEqual(refused, {
		source: SOURCE_GIT_LOCAL,
		branches: [],
		unreadable: "the journal named an attempt of another ticket",
	});
});
