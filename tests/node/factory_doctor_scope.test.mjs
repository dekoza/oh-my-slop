import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { EXIT_USAGE } from "../../factory/lib/cli/exit-codes.mjs";
import { runCli } from "../../factory/lib/cli/main.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { parseScope } from "../../factory/lib/controller/scope.mjs";
import { doctorReport } from "../../factory/lib/doctor/report.mjs";
import { runDoctor } from "../../factory/lib/doctor/verb.mjs";
import { createProbeRegistry } from "../../factory/lib/reconcile/probes.mjs";
import { openRepoStoreReadOnly, openStore } from "../../factory/lib/state/store.mjs";
import { MEMBER_CLASSES } from "../../factory/lib/tracker/frontier.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { FACTORY_LABELS } from "../../factory/lib/tracker/labels.mjs";
import { observe } from "../../factory/lib/tracker/observation.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { FIXED_NOW, makeAgentDir } from "./helpers/factory-store.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";

/**
 * #100 ends here: **`doctor` prints a scope's classified member list, and claims
 * nothing to do it.**
 */

const AT = FIXED_NOW + 200_000;

function tracker(options) {
	const gitea = fakeGitea(options);
	return { gitea, reader: createGiteaReader({ repo: "acme/widgets", login: "kuferek", request: gitea.request }) };
}

async function diagnosable(t) {
	const agentDir = makeAgentDir(t);
	const repoRoot = makeRepo(t);
	const store = await openStore({ repoRoot, agentDir });
	store.close();

	const root = makePackage(t);
	const reader = await openRepoStoreReadOnly({ repoRoot, agentDir });
	t.after(() => reader?.close());
	// §9.7's capacity section is computed from the policy this invocation loaded,
	// so a diagnosis carries the config the way every other verb does.
	const { config, activeRouting } = loadFactoryConfig({ cwd: repoRoot });

	return {
		repoRoot,
		agentDir,
		reader,
		context: {
			repoRoot,
			agentDir: { path: agentDir, source: "caller" },
			config,
			activeRouting,
			executable: join(root, "factory", "bin", "factory.mjs"),
			env: { PATH: onPath(t, join(root, "factory", "bin", "factory.mjs")) },
			probes: createProbeRegistry(),
			at: AT,
		},
	};
}

test("with no scope, doctor makes no tracker read and says why there is no listing", async (t) => {
	const { reader, context } = await diagnosable(t);
	const { gitea, reader: trackerReader } = tracker({ issues: [giteaIssue({ number: 10 })] });

	const report = await doctorReport(reader, { ...context, scope: null, tracker: trackerReader });

	assert.equal(report.scope.requested, false);
	assert.deepEqual(report.scope.members, []);
	assert.match(report.scope.message, /doctor <ticket…>/);
	assert.equal(gitea.calls.length, 0);
	assert.equal(report.ok, true);
});

test("a scope is resolved live and every member is classified", async (t) => {
	const { reader, context } = await diagnosable(t);
	const { reader: trackerReader } = tracker({
		issues: [
			giteaIssue({ number: 10, state: "closed" }),
			giteaIssue({ number: 11 }),
			giteaIssue({ number: 12, labels: ["workflow:implement", FACTORY_LABELS.readyForHuman] }),
			giteaIssue({ number: 13 }),
		],
		dependencies: { 13: [12] },
	});

	const report = await doctorReport(reader, {
		...context,
		scope: parseScope(["10", "11", "12", "13"]),
		tracker: trackerReader,
	});

	assert.equal(report.scope.ok, true);
	assert.equal(report.scope.described, "#10, #11, #12, #13");
	assert.deepEqual(
		report.scope.members.map((member) => [member.ticket, member.class]),
		[
			[10, MEMBER_CLASSES.closed],
			[11, MEMBER_CLASSES.claimable],
			[12, MEMBER_CLASSES.humanOwned],
			[13, MEMBER_CLASSES.blocked],
		],
	);
	assert.deepEqual(report.scope.claimable, [11]);
	assert.equal(report.scope.counts[MEMBER_CLASSES.claimable], 1);
	// Every member carries the reason it is where it is, not just the verdict.
	for (const member of report.scope.members) assert.match(member.reason, /#\d+/);
});

test("the listing claims nothing — no store write, and no tracker call but GET", async (t) => {
	const { reader, context } = await diagnosable(t);
	const { gitea, reader: trackerReader } = tracker({ issues: [giteaIssue({ number: 10 })] });
	const headBefore = reader.head();
	const projectionsBefore = reader.projectionHeads();

	const report = await doctorReport(reader, { ...context, scope: parseScope(["10"]), tracker: trackerReader });

	assert.equal(report.scope.claimed, false);
	assert.match(report.scope.note, /claims nothing/);
	assert.deepEqual(reader.head(), headBefore, "doctor appended to the journal");
	assert.deepEqual(reader.projectionHeads(), projectionsBefore, "doctor wrote a projection");
	for (const { call } of gitea.calls) assert.match(call, /^issue\./);
});

test("doctor reads the observation cursor and never opens one (§5.1, §14.24)", async (t) => {
	const { reader, context, repoRoot, agentDir } = await diagnosable(t);
	const scope = parseScope(["10"]);
	const { reader: trackerReader } = tracker({ issues: [giteaIssue({ number: 10 })] });

	const fresh = await doctorReport(reader, { ...context, scope, tracker: trackerReader });
	assert.equal(fresh.scope.cursor.present, false);
	assert.match(fresh.scope.cursor.message, /opened by a run, never by doctor/);

	// Now let a run open and advance one, and doctor reports it.
	const writable = await openStore({ repoRoot, agentDir });
	await observe(writable, { reader: trackerReader, scope, at: AT });
	writable.close();

	const observed = await doctorReport(reader, { ...context, scope, tracker: trackerReader });
	assert.equal(observed.scope.cursor.present, true);
	assert.equal(observed.scope.cursor.polls, 1);
	assert.equal(observed.scope.cursor.polled_at, AT);
});

test("a tracker that cannot be read is an alarm, and the rest of the diagnosis still answers", async (t) => {
	const { reader, context } = await diagnosable(t);
	const { reader: trackerReader } = tracker({ issues: [], status: { "/issues/10": 503 } });

	const report = await doctorReport(reader, { ...context, scope: parseScope(["10"]), tracker: trackerReader });

	assert.equal(report.scope.ok, false);
	assert.equal(report.scope.error.reason, "tracker-unreachable");
	assert.equal(report.ok, false);
	assert.ok(report.alarms.some((alarm) => alarm.reason === "tracker-unreadable"));
	// One unreadable tracker must not take the journal and the pins down with it.
	assert.equal(report.store.present, true);
	assert.notEqual(report.reconcile, null);
	assert.notEqual(report.package, null);
});

test("the headline names the frontier when one was asked for", async (t) => {
	const { context, repoRoot, agentDir } = await diagnosable(t);
	const { reader: trackerReader } = tracker({
		issues: [giteaIssue({ number: 7 }), giteaIssue({ number: 19 }), giteaIssue({ number: 40, state: "closed" })],
	});

	const answered = await runDoctor({
		repoRoot,
		agentDir,
		config: context.config,
		activeRouting: context.activeRouting,
		args: ["7", "19", "40"],
		tracker: trackerReader,
		probes: context.probes,
		executable: context.executable,
		env: context.env,
		at: AT,
	});

	assert.match(answered.message, /2 claimable of 3 member\(s\), starting at #7/);
});

test("`doctor --parent` resolves membership from the label and the Part of line", async (t) => {
	const { repoRoot, agentDir, context } = await diagnosable(t);
	const { reader: trackerReader } = tracker({
		issues: [
			giteaIssue({ number: 10, body: "Part of #75\n" }),
			giteaIssue({ number: 11, body: "Part of #76\n" }),
		],
	});

	const answered = await runDoctor({
		repoRoot,
		agentDir,
		config: context.config,
		activeRouting: context.activeRouting,
		args: ["75"],
		flags: new Set(["--parent"]),
		tracker: trackerReader,
		probes: context.probes,
		executable: context.executable,
		env: context.env,
		at: AT,
	});

	assert.equal(answered.report.scope.described, "parent #75");
	assert.deepEqual(answered.report.scope.claimable, [10]);
});

test("`doctor --parent` over a parent nothing declares is an alarm, not a healthy zero (#181)", async (t) => {
	const { repoRoot, agentDir, context } = await diagnosable(t);
	const { reader: trackerReader } = tracker({
		issues: [
			// The heading `to-tickets` used to write, in place of §3.1's first line.
			giteaIssue({ number: 10, body: "## Parent\n\nSpecify a reliable Software Factory (#75)" }),
			giteaIssue({ number: 11, body: "Part of #76\n" }),
		],
	});

	const answered = await runDoctor({
		repoRoot,
		agentDir,
		config: context.config,
		activeRouting: context.activeRouting,
		args: ["75"],
		flags: new Set(["--parent"]),
		tracker: trackerReader,
		probes: context.probes,
		executable: context.executable,
		env: context.env,
		at: AT,
	});

	const { report } = answered;
	assert.equal(report.scope.ok, false);
	assert.equal(report.scope.error.reason, "scope-empty");
	assert.equal(report.scope.error.candidates, 2);
	assert.equal(report.ok, false);
	const alarm = report.alarms.find((entry) => entry.reason === "scope-empty");
	assert.notEqual(alarm, undefined, "no scope-empty alarm was raised");
	assert.match(alarm.message, /Part of #75/);
	assert.match(answered.message, /scope-empty/);
	// The tracker answered; this is not the unreadable-tracker alarm wearing a new name.
	assert.equal(report.alarms.some((entry) => entry.reason === "tracker-unreadable"), false);
});

test("a scope that will not parse is a usage refusal, exactly as it is for start", async (t) => {
	const { repoRoot, agentDir } = await diagnosable(t);

	const answered = await runDoctor({ repoRoot, agentDir, args: ["not-a-ticket"] });

	assert.equal(answered.error.kind, "scope-invalid");
	assert.equal(answered.report, undefined);
	// §10.3 reserves 1 for the operator's line being wrong; the same mistyped
	// argument must not reach two different exit codes through two verbs.
	assert.equal(answered.exitCode, EXIT_USAGE);

	const viaCli = await runCli(["doctor", "not-a-ticket"], { cwd: repoRoot, agentDir });
	assert.equal(viaCli.exitCode, EXIT_USAGE);
});

test("the CLI accepts `doctor --parent` and passes the scope through", async (t) => {
	const { repoRoot, agentDir, context } = await diagnosable(t);
	const { reader: trackerReader } = tracker({ issues: [giteaIssue({ number: 10, body: "Part of #75\n" })] });

	const answered = await runCli(["doctor", "--parent", "75", "--json"], {
		cwd: repoRoot,
		agentDir,
		tracker: trackerReader,
		probes: context.probes,
		executable: context.executable,
		env: context.env,
	});

	assert.equal(answered.value.ok, true);
	assert.deepEqual(answered.value.report.scope.claimable, [10]);
});
