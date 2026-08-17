import assert from "node:assert/strict";
import test from "node:test";

import { PROBE_CATALOGUE } from "../../factory/lib/effects/catalogue.mjs";
import { createProbeRegistry } from "../../factory/lib/reconcile/probes.mjs";
import { herdrPaneListProbe, withHerdrProbes } from "../../factory/lib/worker/probes.mjs";
import { fakeHerdr } from "./helpers/factory-worker.mjs";
import { refusalOfAsync } from "./helpers/factory-store.mjs";

/**
 * §5.3: each effect kind's probe ships with the subsystem that introduces the
 * kind. The attempt path introduces `agent-start` and `agent-stop`, and **one
 * read answers both** — plus §12.8's `pane-delete`, which asks the same list a
 * third question.
 */

const ATTEMPT = "01JRUN0000000000000000000A-t42-a1";

/** A Herdr with one pane carrying the attempt's token and a live agent in it. */
async function withPane({ started = true } = {}) {
	const herdr = fakeHerdr();
	// The topology a launch leaves since #156: the run's workspace, and the
	// attempt's own tab inside it.
	const workspace = await herdr.control.openWorkspace({ cwd: "/w", label: "factory-run-R" });
	const tab = await herdr.control.openTab({ workspace: workspace.workspace, cwd: "/w", label: "factory" });
	await herdr.control.stamp(tab.pane, { attempt: ATTEMPT, title: "factory" });
	if (started) await herdr.control.startAgent({ name: "fa1t42a1", kind: "pi", pane: tab.pane });
	return herdr;
}

function ask(herdr, match) {
	return herdrPaneListProbe({ herdr: herdr.control })({
		effect: { effect_key: `R/42/implement/${ATTEMPT}/agent-start`, attempt_id: ATTEMPT },
		probe: { source: "harness", call: "herdr.pane-list", match },
	});
}

test("the catalogue routes both attempt effects through the one read", () => {
	assert.equal(PROBE_CATALOGUE["agent-start"].probe.call, "herdr.pane-list");
	assert.equal(PROBE_CATALOGUE["agent-stop"].probe.call, "herdr.pane-list");
	assert.equal(PROBE_CATALOGUE["pane-delete"].probe.call, "herdr.pane-list");
});

test("agent-start matched needs the token **and** a live agent", async () => {
	assert.equal((await ask(await withPane(), "token-matches")).matched, true);

	// A stamped pane whose agent never started is exactly the crash the launch
	// orders its steps to make visible — and it must not read as started.
	const stampedOnly = await withPane({ started: false });
	assert.equal((await ask(stampedOnly, "token-matches")).matched, false);
});

test("agent-stop matched means no live agent, whether or not the pane went (§13.B)", async () => {
	const herdr = await withPane();
	assert.equal((await ask(herdr, "agent-stopped")).matched, false);

	await herdr.control.stopAgent("fa1t42a1");
	assert.equal((await ask(herdr, "agent-stopped")).matched, true);
	assert.equal((await ask(herdr, "absent")).matched, false, "the pane stays, and it is not a deletion");

	herdr.vanish();
	assert.equal((await ask(herdr, "absent")).matched, true);
});

test("the answer carries the liveness and dates nothing", async () => {
	const answer = await ask(await withPane(), "token-matches");

	assert.equal(answer.result.pane, "w1:p2", "the attempt's tab, inside the run's workspace");
	assert.equal(answer.result.alive, true);
	assert.equal(answer.detail.status, "working");
	assert.match(answer.foreignSourceId, /^herdr:FACTORY_ATTEMPT:/);
	// Herdr's API dates nothing, so there is no raw timestamp to keep verbatim
	// — and inventing one would be our clock wearing Herdr's name (§4.3).
	assert.equal(answer.occurredAtRaw, undefined);
});

test("the foreign id names the fact, so two readings are two facts", async () => {
	const herdr = await withPane();
	const alive = await ask(herdr, "token-matches");
	await herdr.control.stopAgent("fa1t42a1");
	const stopped = await ask(herdr, "agent-stopped");

	assert.notEqual(alive.foreignSourceId, stopped.foreignSourceId, "§5.1's dedup index would suppress the second");
});

test("a multiplexer that will not answer is unanswerable, never absent (§12.4)", async () => {
	const herdr = fakeHerdr({ refuse: { "pane list": { exitCode: 1, stderr: "no server" } } });

	const error = await refusalOfAsync(() => ask(herdr, "token-matches"));

	assert.match(error.message, /unanswerable, not absent/);
});

test("a match the read cannot answer is a refusal: §5.2 gives Herdr one fact", async () => {
	const herdr = await withPane();

	const error = await refusalOfAsync(() => ask(herdr, "sha-equals"));

	assert.match(error.message, /one fact/);
});

test("the probes join a registry of their own, never the shipped singleton", async () => {
	const base = createProbeRegistry();
	base.register("git.rev-parse", () => ({ matched: true }));

	const registry = withHerdrProbes(base, { herdr: (await withPane()).control });

	assert.deepEqual([...registry.calls].sort(), ["git.rev-parse", "herdr.pane-list", "herdr.workspace-list"]);
	assert.equal(base.implementationFor("herdr.pane-list"), null, "one run's multiplexer never answers another's probes");
});
