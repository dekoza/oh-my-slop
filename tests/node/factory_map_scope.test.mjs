import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";

import { EXIT_OK, EXIT_REFUSED, EXIT_USAGE } from "../../factory/lib/cli/exit-codes.mjs";
import { loadFactoryConfig } from "../../factory/lib/config/load.mjs";
import { ENTRY_MODES } from "../../factory/lib/controller/entry.mjs";
import { FOREGROUND_FLAG } from "../../factory/lib/controller/launch.mjs";
import { PARENT_FLAG, SCOPE_FORMS } from "../../factory/lib/controller/scope.mjs";
import { runStart } from "../../factory/lib/controller/start.mjs";
import { runDoctor } from "../../factory/lib/doctor/verb.mjs";
import { newUlid } from "../../factory/lib/identity/ulid.mjs";
import { createProbeRegistry } from "../../factory/lib/reconcile/probes.mjs";
import { openLeases } from "../../factory/lib/state/leases.mjs";
import { openStore } from "../../factory/lib/state/store.mjs";
import { createGiteaReader } from "../../factory/lib/tracker/gitea.mjs";
import { FACTORY_LABELS } from "../../factory/lib/tracker/labels.mjs";
import { createGiteaWriter } from "../../factory/lib/tracker/writer.mjs";
import { makePackage, onPath } from "./helpers/factory-package.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { herdrAnswering, leaseIdentity, makeAgentDir, makeHome } from "./helpers/factory-store.mjs";
import { workerTransportsAnswering } from "./helpers/factory-worker.mjs";
import { fakeGitea, giteaIssue } from "./helpers/factory-tracker.mjs";

/**
 * #182: **`factory start <map>` runs the map's members.**
 *
 * A bare number that carries `wayfinder:map` resolves as the parent-scoped
 * selector over it, without `--parent`; the run records that selector, so §3.1
 * still has two forms and §10.4's live-run comparison is unchanged.
 */

// Factories, not shared records: the fake Gitea mutates an issue a run claims
// and publishes, and a record reused across tests would carry that forward.
const MAP = () => giteaIssue({ number: 75, title: "Specify a reliable Software Factory", labels: [FACTORY_LABELS.map] });
const MEMBER = () => giteaIssue({ number: 120, body: "Part of #75\n\nwork" });
const STRANGER = () => giteaIssue({ number: 121, body: "Part of #76\n" });

function invocation(t) {
	const root = makePackage(t);
	const executable = join(root, "factory", "bin", "factory.mjs");
	const repoRoot = makeRepo(t);

	return {
		repoRoot,
		agentDir: makeAgentDir(t),
		executable,
		env: { PATH: onPath(t, executable), HOME: makeHome(t), HERDR_PANE_ID: "w1:p7" },
		herdr: herdrAnswering(true),
		workerTransports: workerTransportsAnswering(root),
	};
}

async function startOver(t, { world, args, flags = [], lanes = [], context = invocation(t) }) {
	const gitea = fakeGitea(world);
	const loaded = loadFactoryConfig({ cwd: context.repoRoot });
	const where = { repo: loaded.config.tracker.repo, login: loaded.config.tracker.login };

	const answer = await runStart({
		...loaded,
		agentDir: context.agentDir,
		executable: context.executable,
		env: context.env,
		herdr: context.herdr,
		workerTransports: context.workerTransports,
		args: args.map(String),
		flags: new Set([FOREGROUND_FLAG, ...flags]),
		tracker: createGiteaReader({ ...where, request: gitea.request }),
		trackerWriter: createGiteaWriter({ ...where, request: gitea.write }),
		pipeline: async (lane) => {
			lanes.push(lane);
			return { disposition: "published", pr: { number: 7, url: "http://gitea.example/acme/widgets/pulls/7" } };
		},
	});

	return { answer, gitea, context, lanes };
}

async function recordedScope(t, context, run) {
	const store = await openStore({ repoRoot: context.repoRoot, agentDir: context.agentDir });
	t.after(() => store.close());
	return store.readRun(run).scope;
}

test("a bare map number runs the map's members, and the run records the parent-scoped selector", async (t) => {
	const { answer, context, lanes } = await startOver(t, {
		world: { issues: [MAP(), MEMBER(), STRANGER()] },
		args: [75],
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.end_reason, "drained");
	assert.deepEqual(
		lanes.map((lane) => lane.ticket),
		[120],
		"the map's member was not the ticket claimed",
	);

	// What the run recorded is the selector, not the number typed.
	assert.deepEqual(await recordedScope(t, context, answer.report.run), { kind: SCOPE_FORMS.parent, parent: 75 });
	assert.equal(answer.report.scope.kind, SCOPE_FORMS.parent);
	assert.equal(answer.report.scope.parent, 75);
	assert.deepEqual(answer.report.scope.resolved_from, { ticket: 75, label: FACTORY_LABELS.map });
	assert.match(answer.message, /#75 carries wayfinder:map/);
});

test("`--parent` on a map is accepted and records the identical selector", async (t) => {
	const { answer } = await startOver(t, {
		world: { issues: [MAP(), MEMBER()] },
		args: [75],
		flags: [PARENT_FLAG],
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.scope.kind, SCOPE_FORMS.parent);
	assert.equal(answer.report.scope.parent, 75);
	// The flag said it; nothing was rewritten.
	assert.equal(answer.report.scope.resolved_from, null);
});

test("a non-map number is unchanged: a direct-ticket set of one", async (t) => {
	const { answer, lanes } = await startOver(t, {
		world: { issues: [MAP(), MEMBER()] },
		args: [120],
	});

	assert.equal(answer.exitCode, EXIT_OK);
	assert.deepEqual(answer.report.scope.tickets, [120]);
	assert.equal(answer.report.scope.resolved_from, null);
	assert.deepEqual(
		lanes.map((lane) => lane.ticket),
		[120],
	);
});

test("a map beside other tickets is a usage refusal naming the map", async (t) => {
	const { answer, lanes, gitea } = await startOver(t, {
		world: { issues: [MAP(), MEMBER()] },
		args: [75, 120],
	});

	assert.equal(answer.exitCode, EXIT_USAGE);
	assert.equal(answer.error.kind, "scope-invalid");
	assert.deepEqual(answer.error.maps, [75]);
	assert.match(answer.error.message, /factory start 75/);
	assert.deepEqual(lanes, []);
	assert.deepEqual(gitea.writes, []);
});

test("a map whose members are none is the #181 refusal, pointing at the first-line contract", async (t) => {
	const { answer } = await startOver(t, {
		world: { issues: [MAP(), giteaIssue({ number: 120, body: "## Parent\n\n#75" })] },
		args: [75],
	});

	assert.equal(answer.exitCode, EXIT_REFUSED);
	assert.equal(answer.error.kind, "scope-empty");
	assert.equal(answer.error.parent, 75);
});

test("a tracker that cannot be read while the line is resolved is a typed refusal, and no run is opened", async (t) => {
	const { answer, lanes } = await startOver(t, {
		world: { issues: [MAP(), MEMBER()], status: { "/issues/75": 503 } },
		args: [75],
	});

	assert.equal(answer.exitCode, EXIT_REFUSED);
	assert.equal(answer.error.kind, "scope-unreadable");
	assert.equal(answer.error.tracker.reason, "tracker-unreachable");
	assert.match(answer.error.message, /factory start 75/);
	assert.deepEqual(lanes, []);
});

async function liveRun(context, scope) {
	const run = newUlid();
	const store = await openStore({ repoRoot: context.repoRoot, agentDir: context.agentDir });
	const at = Date.now();
	store.append({
		kind: "run.started",
		source: "controller",
		run,
		occurredAt: at,
		observedAt: at,
		payload: { scope, mode: ENTRY_MODES.started },
	});
	openLeases(store).acquire({ name: "controller", identity: leaseIdentity({ run, pane: "w1:p3" }) });
	store.close();
	return run;
}

test("a map against a live run over the same map is already in scope (§10.4)", async (t) => {
	const context = invocation(t);
	const live = await liveRun(context, { kind: SCOPE_FORMS.parent, parent: 75 });

	const { answer } = await startOver(t, { context, world: { issues: [MAP(), MEMBER()] }, args: [75] });

	assert.equal(answer.exitCode, EXIT_OK);
	assert.equal(answer.report.run, live);
	assert.match(answer.message, /already in scope/);
});

test("a map against a live run over something else refuses, naming the live run", async (t) => {
	const context = invocation(t);
	const live = await liveRun(context, { kind: SCOPE_FORMS.direct, tickets: [40] });

	const { answer } = await startOver(t, { context, world: { issues: [MAP(), MEMBER()] }, args: [75] });

	assert.equal(answer.exitCode, EXIT_REFUSED);
	assert.equal(answer.error.kind, "run-out-of-scope");
	assert.equal(answer.error.run, live);
});

test("`doctor <map>` classifies the map's members, not the map", async (t) => {
	const context = invocation(t);
	const gitea = fakeGitea({ issues: [MAP(), MEMBER(), STRANGER()] });
	const { config, activeRouting } = loadFactoryConfig({ cwd: context.repoRoot });

	const answered = await runDoctor({
		repoRoot: context.repoRoot,
		agentDir: context.agentDir,
		config,
		activeRouting,
		args: ["75"],
		tracker: createGiteaReader({ repo: config.tracker.repo, login: config.tracker.login, request: gitea.request }),
		probes: createProbeRegistry(),
		executable: context.executable,
		env: context.env,
	});

	assert.equal(answered.report.scope.described, "parent #75");
	assert.deepEqual(answered.report.scope.claimable, [120]);
	assert.deepEqual(answered.report.scope.resolved_from, { ticket: 75, label: FACTORY_LABELS.map });
	assert.equal(answered.report.scope.candidates, 2);
});
