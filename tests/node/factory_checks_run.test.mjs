import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CHECK_SELECTIONS, checkRecord, runChecks } from "../../factory/lib/checks/run.mjs";
import { CHECK_RESULTS } from "../../factory/lib/domain/vocabulary.mjs";

/**
 * §8.2: **mechanical checks are declared, never discovered**, the full required
 * set runs every time, and the result is classified by **fault attribution** —
 * a non-zero exit inside the declared contract is the worker's failure, and
 * everything else is the automation's.
 *
 * These drive real processes in a real directory. Every statement the runner
 * makes — an exit code, a signal, a timeout, a command that is not there — is a
 * statement about a process, and none of them is observable through a mock.
 */

function workspace(t) {
	const dir = mkdtempSync(join(tmpdir(), "factory-checks-"));
	t.after(() => rmSync(dir, { recursive: true, force: true }));
	return dir;
}

/** A declared check, with §11.6's five fields and nothing defaulted here either. */
function check({ name = "unit", command, timeout = 30, severity = "required", expectedFailureExitCodes = [1] }) {
	return { name, command, timeout, severity, expectedFailureExitCodes };
}

function resultOf(answer, name = "unit") {
	return answer.results.find((result) => result.name === name);
}

// ── The declared set (§8.2, §14.34) ──────────────────────────────────────────

test("the full required set runs every time, in the order it was declared", async (t) => {
	const cwd = workspace(t);

	const answer = await runChecks(
		[
			check({ name: "one", command: "echo one >> order" }),
			check({ name: "two", command: "echo two >> order" }),
			check({ name: "three", command: "echo three >> order" }),
		],
		{ select: CHECK_SELECTIONS.required, cwd },
	);

	assert.equal(answer.ok, true);
	assert.deepEqual(
		answer.results.map((result) => result.name),
		["one", "two", "three"],
	);
	assert.equal(readFileSync(join(cwd, "order"), "utf8"), "one\ntwo\nthree\n");
});

test("nothing is inferred from a manifest or a Makefile — only the declared list runs (§14.34)", async (t) => {
	const cwd = workspace(t);
	for (const name of ["pyproject.toml", "package.json", "Makefile", "AGENTS.md"]) {
		writeFileSync(join(cwd, name), "test:\n\techo inferred >> inferred\n", "utf8");
	}

	const answer = await runChecks([check({ command: "echo declared > declared" })], {
		select: CHECK_SELECTIONS.required,
		cwd,
	});

	assert.deepEqual(
		answer.results.map((result) => result.command),
		["echo declared > declared"],
	);
	assert.throws(() => readFileSync(join(cwd, "inferred")), /ENOENT/);
});

test("there is no per-surface targeting: the selector is required or all, and nothing else", async () => {
	const declared = [check({ command: "true" })];

	await assert.rejects(() => runChecks(declared, { select: "changed-files", cwd: process.cwd() }), (error) => {
		assert.equal(error.reason, "check-selection-unknown");
		assert.match(error.message, /§8\.2/);
		return true;
	});
});

// ── Fault attribution (§8.2) ─────────────────────────────────────────────────

test("a green check passes, carrying its exit code and duration", async (t) => {
	const answer = await runChecks([check({ command: "exit 0" })], {
		select: CHECK_SELECTIONS.required,
		cwd: workspace(t),
	});

	const result = resultOf(answer);
	assert.equal(result.result, CHECK_RESULTS.passed);
	assert.equal(result.exit_code, 0);
	assert.equal(result.reason, null);
	assert.ok(result.duration_ms >= 0);
});

test("a required check exiting inside its declared contract is a genuine failure", async (t) => {
	const answer = await runChecks([check({ command: "exit 1", expectedFailureExitCodes: [1, 2, 5] })], {
		select: CHECK_SELECTIONS.required,
		cwd: workspace(t),
	});

	assert.equal(resultOf(answer).result, CHECK_RESULTS.failed);
	assert.equal(resultOf(answer).exit_code, 1);
	assert.equal(answer.ok, false);
	assert.deepEqual(answer.red, ["unit"]);
});

test("an exit code outside the declared contract is unrunnable, never the worker's failure", async (t) => {
	const answer = await runChecks([check({ command: "exit 3", expectedFailureExitCodes: [1] })], {
		select: CHECK_SELECTIONS.required,
		cwd: workspace(t),
	});

	const result = resultOf(answer);
	assert.equal(result.result, CHECK_RESULTS.unrunnable);
	assert.equal(result.reason, "unexpected-exit-code");
	assert.equal(result.exit_code, 3);
	assert.equal(answer.ok, false, "an unrunnable required check still stops the run");
});

test("a command that is not there is unrunnable, and says so by name", async (t) => {
	const answer = await runChecks(
		[check({ command: "definitely-not-a-command --version", expectedFailureExitCodes: [1] })],
		{ select: CHECK_SELECTIONS.required, cwd: workspace(t) },
	);

	const result = resultOf(answer);
	assert.equal(result.result, CHECK_RESULTS.unrunnable);
	assert.equal(result.reason, "exec-not-found");
});

test("a check killed by a signal is unrunnable, naming the signal", async (t) => {
	const answer = await runChecks([check({ command: "kill -KILL $$" })], {
		select: CHECK_SELECTIONS.required,
		cwd: workspace(t),
	});

	const result = resultOf(answer);
	assert.equal(result.result, CHECK_RESULTS.unrunnable);
	assert.equal(result.reason, "signal");
	assert.equal(result.signal, "SIGKILL");
	assert.equal(result.exit_code, null);
});

test("a check that outruns its mandatory timeout is unrunnable, and its process tree dies with it", async (t) => {
	const cwd = workspace(t);

	// The background child outlives the shell the timeout kills, so only a *group*
	// kill stops it writing. A timed-out suite left running is what holds the port
	// the next check needs.
	const answer = await runChecks(
		[check({ command: "(sleep 2; echo survived > survivor) &\nsleep 30", timeout: 1 })],
		{ select: CHECK_SELECTIONS.required, cwd },
	);

	const result = resultOf(answer);
	assert.equal(result.result, CHECK_RESULTS.unrunnable);
	assert.equal(result.reason, "timeout");
	assert.equal(result.timeout_ms, 1000);
	assert.ok(result.duration_ms < 15_000, "the runner waited for a check it had already given up on");

	await new Promise((resolve) => setTimeout(resolve, 2_500));
	assert.throws(() => readFileSync(join(cwd, "survivor")), /ENOENT/, "a timed-out check left its children running");
});

test("an expected-failure code the operator declared wins over every other reading of it", async (t) => {
	// 127 is what a shell answers for a command it cannot find, and a repo may
	// legitimately declare it: the declaration is the contract (§8.2, §11.6).
	const answer = await runChecks([check({ command: "exit 127", expectedFailureExitCodes: [127] })], {
		select: CHECK_SELECTIONS.required,
		cwd: workspace(t),
	});

	assert.equal(resultOf(answer).result, CHECK_RESULTS.failed);
});

// ── Advisory checks record evidence and never block (§8.2) ───────────────────

test("an advisory check that fails records its evidence and blocks nothing", async (t) => {
	const answer = await runChecks(
		[
			check({ name: "unit", command: "exit 0" }),
			check({ name: "e2e", command: "exit 1", severity: "advisory" }),
		],
		{ select: CHECK_SELECTIONS.all, cwd: workspace(t) },
	);

	assert.equal(resultOf(answer, "e2e").result, CHECK_RESULTS.failed);
	assert.equal(answer.ok, true, "an advisory result coloured the verdict");
	assert.deepEqual(answer.red, []);
});

test("an advisory check that cannot run blocks nothing either", async (t) => {
	const answer = await runChecks([check({ name: "e2e", command: "exit 9", severity: "advisory" })], {
		select: CHECK_SELECTIONS.all,
		cwd: workspace(t),
	});

	assert.equal(resultOf(answer, "e2e").result, CHECK_RESULTS.unrunnable);
	assert.equal(answer.ok, true);
});

test("the required selection runs the required set alone, and says which it skipped", async (t) => {
	const cwd = workspace(t);

	const answer = await runChecks(
		[
			check({ name: "unit", command: "echo unit >> ran" }),
			check({ name: "e2e", command: "echo e2e >> ran", severity: "advisory" }),
		],
		{ select: CHECK_SELECTIONS.required, cwd },
	);

	assert.deepEqual(
		answer.results.map((result) => result.name),
		["unit"],
	);
	assert.deepEqual(answer.skipped, ["e2e"]);
	assert.equal(readFileSync(join(cwd, "ran"), "utf8"), "unit\n");
});

// ── Output is evidence, and never embedded (§8.7, §12.1) ─────────────────────

test("output is captured as bytes and the record carries only its size", async (t) => {
	const answer = await runChecks([check({ command: "echo out; echo err >&2" })], {
		select: CHECK_SELECTIONS.required,
		cwd: workspace(t),
	});

	const result = resultOf(answer);
	assert.match(result.output.toString("utf8"), /out/);
	assert.match(result.output.toString("utf8"), /err/, "stderr is evidence too");
	assert.equal(result.output_bytes, result.output.length);

	// The record's `output` slot holds §6.6's reference and never the bytes; with
	// no artifact written for it yet, it is empty rather than inlined.
	const record = checkRecord(result);
	assert.equal(record.output, null, "the record embedded the bytes");
	assert.equal(record.output_bytes, result.output_bytes);
	assert.ok(
		!Object.values(record).some((field) => Buffer.isBuffer(field)),
		"the record carried the check's own output",
	);
});

test("runaway output is capped, and the cap is recorded rather than silent", async (t) => {
	const answer = await runChecks([check({ command: "yes 0123456789 | head -c 3000000" })], {
		select: CHECK_SELECTIONS.required,
		cwd: workspace(t),
		maxOutputBytes: 4096,
	});

	const result = resultOf(answer);
	assert.equal(result.output.length, 4096);
	assert.equal(result.truncated, true);
	assert.equal(result.result, CHECK_RESULTS.passed, "capping the capture changed the verdict");
});

// ── §14.23: two lanes never run mechanical checks concurrently ───────────────

test("two callers never run mechanical checks at the same time", async (t) => {
	const cwd = workspace(t);
	// Each check brackets its own run in a shared log. Overlapping runs interleave
	// the brackets; serialized ones cannot.
	const bracket = (name) => check({ name, command: `echo ${name}-in >> log; sleep 0.2; echo ${name}-out >> log` });

	await Promise.all([
		runChecks([bracket("a")], { select: CHECK_SELECTIONS.required, cwd }),
		runChecks([bracket("b")], { select: CHECK_SELECTIONS.required, cwd }),
	]);

	const log = readFileSync(join(cwd, "log"), "utf8").trim().split("\n");
	assert.equal(log.length, 4);
	assert.equal(log[0].replace("-in", ""), log[1].replace("-out", ""), `checks interleaved: ${log.join(" ")}`);
	assert.equal(log[2].replace("-in", ""), log[3].replace("-out", ""), `checks interleaved: ${log.join(" ")}`);
});

test("an unreadable selection refuses before a single process is started", async (t) => {
	const cwd = workspace(t);

	await assert.rejects(() => runChecks([check({ command: "echo ran > ran" })], { select: "nonsense", cwd }));

	assert.throws(() => readFileSync(join(cwd, "ran")), /ENOENT/);
});
