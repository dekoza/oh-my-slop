import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FactoryRunError, RUN_ERROR_REASONS } from "../../factory/lib/controller/errors.mjs";
import { HERDR_REMEDIES, probeHerdr } from "../../factory/lib/controller/herdr.mjs";
import {
	describeScope,
	isScope,
	parseScope,
	sameScope,
	scopeCovers,
	SCOPE_FORMS,
} from "../../factory/lib/controller/scope.mjs";
import { factorySources } from "./helpers/factory-repo.mjs";
import { refusalOf } from "./helpers/factory-store.mjs";

/**
 * §3.1's selector and §10.3's named availability probe — the two pieces of
 * `factory start` that answer questions before any run exists.
 */

// ── §3.1's two scope forms ───────────────────────────────────────────────────

test("bare issue numbers are the direct-ticket set, deduplicated and ordered", () => {
	assert.deepEqual(parseScope(["43", "#42", "42"]), { kind: SCOPE_FORMS.direct, tickets: [42, 43] });
});

test("--parent names the one parent whose members the run covers", () => {
	assert.deepEqual(parseScope(["#75"], { parent: true }), { kind: SCOPE_FORMS.parent, parent: 75 });
});

test("a parent-scoped run has exactly one parent", () => {
	const error = refusalOf(() => parseScope(["75", "76"], { parent: true }));

	assert.equal(error.reason, "scope-invalid");
	assert.deepEqual(error.details.found, [75, 76]);
});

test("--parent with nothing to name refuses rather than scoping to everything", () => {
	assert.equal(refusalOf(() => parseScope([], { parent: true })).reason, "scope-invalid");
});

test("no arguments is no scope, which is a re-entry rather than an error", () => {
	assert.equal(parseScope([]), null);
});

test("anything that is not an issue number refuses: the tracker is the queue", () => {
	for (const argument of ["auth", "0", "-3", "42x", ""]) {
		assert.equal(refusalOf(() => parseScope([argument])).reason, "scope-invalid", argument);
	}
});

test("a selector shape this build does not recognise is not treated as a selector", () => {
	assert.equal(isScope({ kind: "everything" }), false);
	assert.equal(isScope(null), false);
	assert.equal(isScope({ kind: SCOPE_FORMS.direct, tickets: [1] }), true);
	assert.equal(isScope({ kind: SCOPE_FORMS.parent, parent: 75 }), true);
});

// ── §10.4's resolution against a live selector ───────────────────────────────

const direct = (...tickets) => ({ kind: SCOPE_FORMS.direct, tickets });
const parent = (issue) => ({ kind: SCOPE_FORMS.parent, parent: issue });

test("a live direct set covers the tickets it already names, and nothing else", () => {
	assert.equal(scopeCovers(direct(40, 42), direct(42)), true);
	assert.equal(scopeCovers(direct(40, 42), direct(40, 42)), true);
	assert.equal(scopeCovers(direct(40, 42), direct(43)), false);
	assert.equal(scopeCovers(direct(40, 42), direct(42, 43)), false);
});

test("asking nothing of a live run is never out of scope", () => {
	assert.equal(scopeCovers(direct(40), null), true);
	assert.equal(scopeCovers(parent(75), null), true);
});

test("the same parent is in scope; a different one is not", () => {
	assert.equal(scopeCovers(parent(75), parent(75)), true);
	assert.equal(scopeCovers(parent(75), parent(76)), false);
	assert.equal(scopeCovers(direct(40), parent(75)), false);
});

test("a ticket against a live parent is undecidable here, and says so rather than guessing", () => {
	// `Part of #N` is a tracker read (§3.1). `false` would refuse a member that
	// really is one; `true` would promise a frontier that never arrives.
	assert.equal(scopeCovers(parent(75), direct(42)), null);
});

test("sameScope compares selectors, not object identity", () => {
	assert.equal(sameScope(direct(40, 42), direct(40, 42)), true);
	assert.equal(sameScope(direct(40, 42), direct(42, 40)), false, "order is normalised at parse time, not here");
	assert.equal(sameScope(parent(75), direct(75)), false);
});

test("a selector renders as something an operator can read in a refusal", () => {
	assert.equal(describeScope(direct(42, 43)), "#42, #43");
	assert.equal(describeScope(parent(75)), "parent #75");
	assert.equal(describeScope(null), "(none given)");
});

test("the run refusals are a closed set the constructor enforces", () => {
	assert.throws(() => new FactoryRunError("something-went-wrong", "…"), /Unknown run error reason/);
	assert.ok(RUN_ERROR_REASONS.includes("scope-required"));
});

// ── §10.3's Herdr availability probe ─────────────────────────────────────────

/** A real Unix socket with something listening, and one with nothing. */
function socketDir(t) {
	const dir = mkdtempSync(join(tmpdir(), "factory-herdr-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

function listening(t, path) {
	const server = createServer();
	server.listen(path);
	t.after(() => server.close());
	return path;
}

/** An executable named `herdr` on a PATH of its own — an install, in miniature. */
function herdrOnPath(t) {
	const bin = socketDir(t);
	writeFileSync(join(bin, "herdr"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
	return bin;
}

test("Herdr is available when the binary resolves and something answers on the socket", async (t) => {
	const socket = listening(t, join(socketDir(t), "herdr.sock"));
	const env = { PATH: herdrOnPath(t), HERDR_SOCKET_PATH: socket };

	const answer = await probeHerdr({ env });

	assert.equal(answer.available, true);
	assert.equal(answer.socket, socket);
	assert.equal(answer.command, null);
});

test("a binary on PATH whose server is down fails closed with the command that starts it", async (t) => {
	const env = { PATH: herdrOnPath(t), HERDR_SOCKET_PATH: join(socketDir(t), "herdr.sock") };

	const answer = await probeHerdr({ env });

	assert.equal(answer.available, false);
	assert.equal(answer.reason, "herdr-server-down");
	assert.equal(answer.command, HERDR_REMEDIES.start);
	assert.match(answer.message, /herdr server/, "the headless alternative is offered too");
});

test("no Herdr at all says so, and points at the install rather than at a start command", async (t) => {
	const answer = await probeHerdr({ env: { PATH: socketDir(t), HERDR_SOCKET_PATH: "/nonexistent/herdr.sock" } });

	assert.equal(answer.available, false);
	assert.equal(answer.reason, "herdr-not-installed");
	assert.equal(answer.binary, null);
	assert.equal(answer.command, HERDR_REMEDIES.install);
});

test("the socket a pane was told about wins over the documented default", async (t) => {
	const declared = join(socketDir(t), "declared.sock");
	const env = { PATH: herdrOnPath(t), HERDR_SOCKET_PATH: declared, HOME: "/home/nobody" };

	assert.equal((await probeHerdr({ env })).socket, declared);
	assert.equal(
		(await probeHerdr({ env: { ...env, HERDR_SOCKET_PATH: undefined } })).socket,
		"/home/nobody/.config/herdr/herdr.sock",
	);
});

test("the probe never starts, installs, or configures the operator's multiplexer", () => {
	// The factory checks the multiplexer; it does not manage one (§10.3). The
	// checkable form of that is that the module cannot run anything: it imports
	// no process-spawning API, so there is no path along which a probe becomes a
	// decision about the operator's session.
	const source = new Map(factorySources()).get("lib/controller/herdr.mjs");

	assert.doesNotMatch(source, /node:child_process|spawn|execFile|exec\(/);
	assert.equal(HERDR_REMEDIES.start, "herdr", "the remedy is a command an operator types, not a script");
});
