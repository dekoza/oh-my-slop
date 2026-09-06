import test from "node:test";
import assert from "node:assert/strict";
import { runCli, renderHuman } from "../../factory/lib/cli/main.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { policyFixture } from "./helpers/factory-policy.mjs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

async function inspect(fixture, args = []) {
	const { createDesiredPolicyResolver } = await import("../../factory/lib/config/policy-resolver.mjs");
	const policyResolver = createDesiredPolicyResolver({
		operatorMount: fixture.mount, operatorUid: process.getuid(),
		readLogin: async () => ({ url: "https://forge.invalid", sshHost: "forge.invalid" }),
	});
	return runCli(["doctor", "--policy", ...args], { cwd: fixture.cwd, policyResolver });
}

test("doctor --policy refuses conflicting modes before reading any policy", async (t) => {
	const cwd = makeRepo(t, { config: null, remotes: {} });
	for (const args of [["--baseline"], ["23"], ["--parent", "23"]]) {
		const result = await runCli(["doctor", "--policy", ...args, "--json"], { cwd });
		assert.equal(result.exitCode, 1);
		assert.equal(result.value.error.kind, "usage");
		assert.match(renderHuman(result.value), /--policy cannot combine/);
	}
});


test("doctor previews exact source policy from a subdirectory without observations", async (t) => {
	const fixture = policyFixture(t);
	const result = await inspect(fixture);
	assert.equal(result.exitCode, 0);
	const resolution = result.value.report.policyResolution;
	assert.equal(resolution.state, "preview");
	assert.equal(resolution.appliedRevision, null);
	assert.deepEqual(resolution.policy.operator, fixture.operator);
	assert.deepEqual(resolution.policy.repository, fixture.repository);
	assert.equal(resolution.policy.provenance.repositoryFile, fixture.repositoryFile);
	assert.equal(resolution.policy.provenance.operatorFile, "/etc/oh-my-slop/factory/operator.json");
	const digest = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
	assert.equal(resolution.policy.provenance.operatorDigest, digest(fixture.operatorFile));
	assert.equal(resolution.policy.provenance.repositoryDigest, digest(fixture.repositoryFile));
	assert.deepEqual(resolution.policy.limits, { aggregate: 1, resources: { gpu: 1 } });
	assert.deepEqual(resolution.policy.profileAvailability, { builder: "enabled" });
	const human = renderHuman(result.value);
	assert.match(human, /configured/i);
	for (const name of ["applied state", "occupancy", "deployment enforcement", "provider capability"]) {
		assert.ok(human.includes(`${name}: not observed`), human);
	}
});
