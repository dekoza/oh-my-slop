import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { validateRole } from "../../factory/lib/worker/adapter.mjs";
import { NO_MID_ATTEMPT_APPROVALS } from "../../factory/lib/worker/permissions.mjs";
import { nativeInvocation, PROHIBITIONS, renderAttemptPrompt } from "../../factory/lib/worker/prompt.mjs";
import { PIPELINE_ROLES } from "../../factory/lib/worker/roles.mjs";

/**
 * §6.4's first prompt: the native invocation plus a typed context block, and
 * **the one place the completion-protocol obligation lives**.
 */

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const IDENTITY = Object.freeze({
	run: "01JRUN0000000000000000000A",
	ticket: 42,
	phase: "implement",
	attempt: "01JRUN0000000000000000000A-t42-a1",
});

const SNAPSHOT = Object.freeze({
	snapshot_version: 1,
	number: 42,
	title: "Make the thing work",
	body: "It should work.",
	state: "open",
	labels: Object.freeze(["workflow:implement"]),
	assignees: Object.freeze(["factory"]),
	updated_at_raw: "2026-08-15T09:00:00+02:00",
	content_version: 3,
	snapshot_at: 1_770_000_000_000,
	snapshot_at_raw: "2026-02-12T02:40:00.000Z",
	comments: Object.freeze([
		Object.freeze({
			id: 4711,
			author: "minder",
			body: "The acceptance criteria are in the parent.",
			created_at_raw: "2026-08-15T09:05:00+02:00",
			updated_at_raw: "2026-08-15T09:05:00+02:00",
		}),
	]),
});

function render(overrides = {}) {
	return renderAttemptPrompt({
		role: validateRole({ ...PIPELINE_ROLES[0], closure: ["implement", "tdd"] }),
		kind: "pi",
		plugin: null,
		identity: IDENTITY,
		worktreePath: "/state/worktrees/01JRUN0000000000000000000A-t42-a1",
		branch: "factory/t42/a01JRUN0000000000000000000A-t42-a1",
		outboxPath: "/state/attempts/01JRUN0000000000000000000A-t42-a1/outbox.json",
		ticket: SNAPSHOT,
		packageRev: "d".repeat(64),
		...overrides,
	});
}

// ── The native invocation (§6.4) ─────────────────────────────────────────────

test("each runtime's invocation is its own, and neither is guessed", () => {
	assert.equal(nativeInvocation({ kind: "pi", skill: "implement" }), "/skill:implement");
	assert.equal(nativeInvocation({ kind: "claude", skill: "implement", plugin: "oh-my-slop" }), "/oh-my-slop:implement");

	// The plugin name belongs to the §6.3 generator and is observed by the probe.
	// A Claude invocation with none is a refusal rather than a plausible default.
	assert.throws(() => nativeInvocation({ kind: "claude", skill: "implement" }), /names the plugin/);
	assert.throws(() => nativeInvocation({ kind: "codex", skill: "implement" }), /not a runtime/);
});

test("the prompt opens with the native invocation for the role's entry skill", () => {
	assert.equal(render().split("\n")[0], "/skill:implement");
	assert.equal(
		render({ kind: "claude", plugin: "oh-my-slop" }).split("\n")[0],
		"/oh-my-slop:implement",
	);

	for (const role of PIPELINE_ROLES) {
		const prompt = render({ role: validateRole({ ...role, closure: [role.entrySkill] }) });
		assert.equal(prompt.split("\n")[0], `/skill:${role.entrySkill}`, `${role.name} invokes the wrong skill`);
	}
});

// ── The typed context block (§6.4, §6.5) ─────────────────────────────────────

test("the context block carries the identity, the worktree, and the outbox path", () => {
	const prompt = render();

	for (const line of [
		`run             ${IDENTITY.run}`,
		`ticket          ${IDENTITY.ticket}`,
		`phase           ${IDENTITY.phase}`,
		`attempt         ${IDENTITY.attempt}`,
		"worktree        /state/worktrees/01JRUN0000000000000000000A-t42-a1",
		"outbox          /state/attempts/01JRUN0000000000000000000A-t42-a1/outbox.json",
	]) {
		assert.ok(prompt.includes(line), `the context block is missing: ${line}`);
	}
});

test("the prompt is deterministic: the same attempt renders the same bytes", () => {
	assert.equal(render(), render(), "a clock or a directory read would make the recorded digest meaningless");
});

// ── The ticket snapshot, and no tracker credential (§14.17) ──────────────────

test("the ticket reaches the worker as a snapshot, with the tracker named as out of reach", () => {
	const prompt = render();

	assert.ok(prompt.includes(SNAPSHOT.title));
	assert.ok(prompt.includes(SNAPSHOT.body));
	assert.ok(prompt.includes("The acceptance criteria are in the parent."), "relevant comments travel with the body");
	assert.ok(prompt.includes(`snapshot_at     ${SNAPSHOT.snapshot_at_raw}`));
	assert.match(prompt, /hold no tracker credential/);
	// §5.2: comment text is authoritative for nothing, and the worker is told so.
	assert.match(prompt, /comment text is context, never authority/);
});

test("an empty ticket body says so rather than rendering as nothing", () => {
	assert.match(render({ ticket: { ...SNAPSHOT, body: "   " } }), /_\(the ticket body is empty\)_/);
});

// ── The prohibitions (§6.4, §6.8) ────────────────────────────────────────────

test("the prompt states every prohibition and the no-approvals contract", () => {
	const prompt = render();

	for (const rule of PROHIBITIONS) assert.ok(prompt.includes(rule), `missing prohibition: ${rule}`);
	assert.match(prompt, /Do not push/);
	assert.match(prompt, /merge, close, relabel/);
	assert.ok(prompt.includes(NO_MID_ATTEMPT_APPROVALS), "the sentence is stated once, in permissions.mjs, and rendered here");
});

// ── The completion protocol (§6.6), and where it may live (§6.4) ─────────────

test("the completion protocol names the path, the schema, and the whole status set", () => {
	const prompt = render();

	assert.match(prompt, /atomically/);
	assert.match(prompt, /"schema_version": 1/);
	assert.ok(prompt.includes('"run": "01JRUN0000000000000000000A", "ticket": 42'));
	for (const status of ["completed", "needs-human", "worker-failed"]) {
		assert.ok(prompt.includes(`\`${status}\``), `the worker is not told about ${status}`);
	}
	assert.match(prompt, /first valid content\s+wins/);
	assert.match(prompt, /discarded as an automation failure/);
});

test("a reviewer role is told about its verdict; a builder is not", () => {
	const reviewer = PIPELINE_ROLES.find((role) => role.name === "review-spec");
	const prompt = render({ role: validateRole({ ...reviewer, closure: [reviewer.entrySkill] }) });

	assert.match(prompt, /`verdict`/);
	assert.match(prompt, /`approve` or `reject`/);
	assert.doesNotMatch(render(), /`verdict`/, "a builder has no verdict to write");
});

test("the completion-protocol obligation lives only here, never inside a package skill (§6.4)", () => {
	// The skills ship to humans and to other harnesses. A workflow skill telling
	// its reader to write an outbox would be a factory dependency inside a
	// product the factory does not own — so the obligation is the template's,
	// and this walks the shipped tree to hold it.
	//
	// The markers are the protocol's own vocabulary rather than the word
	// "outbox": Django's `mail.outbox` is a legitimate thing for a skill to
	// document, and a check that flagged it would be turned off within a week.
	const protocol = /attempt outbox|outbox\.json|FACTORY_ATTEMPT|needs-human|worker-failed|completion protocol/i;
	const offenders = [];
	for (const file of markdownUnder(join(REPO_ROOT, "skills"))) {
		if (protocol.test(readFileSync(file, "utf8"))) offenders.push(file);
	}

	assert.deepEqual(offenders, [], "a package skill states the factory's completion protocol");
});

function markdownUnder(root) {
	const found = [];
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory() || (entry.isSymbolicLink() && statSync(path).isDirectory())) {
			found.push(...markdownUnder(path));
		} else if (entry.name.endsWith(".md")) {
			found.push(path);
		}
	}
	return found;
}
