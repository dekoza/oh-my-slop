import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { runCli, renderHuman } from "../../factory/lib/cli/main.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { policyFixture } from "./helpers/factory-policy.mjs";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

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

test("invalid desired revisions return actionable typed refusals without source excerpts", async (t) => {
	for (const [code, scope, mutate] of [
		["unsupported-version", "operator", (f) => { f.operator.schemaVersion = 2; }],
		["ownership-conflict", "repository", (f) => { f.repository.profiles = {}; }],
		["ownership-conflict", "repository", (f) => { f.repository.concurrency.resources = { gpu: 9 }; }],
		["unknown-reference", "operator", (f) => { f.operator.profiles.builder.bindingId = "missing"; }],
		["unknown-reference", "repository", (f) => { f.repository.routing.roles.implement = "missing"; }],
		["identity-mismatch", "repository", (f) => { f.repository.operatorId = "another_operator"; }],
		["ambiguous-binding", "operator", (f) => { f.operator.resources.alias = structuredClone(f.operator.resources.gpu); }],
		["invalid-document", "operator", (f) => { f.operator.credentials.secret = { token: "NEVER_DISCLOSE_THIS" }; }],
	]) {
		await t.test(`${code}: ${scope}`, async (t) => {
			const fixture = policyFixture(t);
			mutate(fixture);
			fixture.save();
			const result = await inspect(fixture);
			assert.equal(result.exitCode, 1);
			assert.equal(result.value.error.kind, "config-load");
			assert.equal(result.value.error.reason, code);
			const resolution = result.value.error.policyResolution;
			assert.equal(resolution.rejection.scope, scope);
			assert.ok(resolution.rejection.question);
			assert.equal(resolution.policy, null);
			assert.match(resolution.desiredRevision, /^[a-f0-9]{64}$/);
			assert.doesNotMatch(JSON.stringify(result.value) + renderHuman(result.value), /NEVER_DISCLOSE_THIS/);
		});
	}
});

test("duplicate JSON keys refuse even when escape spelling differs", async (t) => {
	const fixture = policyFixture(t);
	const source = readFileSync(fixture.operatorFile, "utf8");
	writeFileSync(fixture.operatorFile, source.replace('"enabled": true', '"enabled": false, "\\u0065nabled": true'));
	const result = await inspect(fixture);
	assert.equal(result.exitCode, 1);
	assert.equal(result.value.error.reason, "invalid-document");
});

test("repository identity includes the selected login's forge host and SSH port", async (t) => {
	const fixture = policyFixture(t);
	for (const url of ["https://other.invalid/acme/widgets.git", "https://forge.invalid/acme/other.git", "ssh://git@forge.invalid:2222/acme/widgets.git"]) {
		execFileSync("git", ["remote", "set-url", "gitea", url], { cwd: fixture.root });
		const result = await inspect(fixture);
		assert.equal(result.exitCode, 1, url);
		assert.equal(result.value.error.reason, "identity-mismatch");
	}
	execFileSync("git", ["remote", "set-url", "gitea", "git@forge.invalid:acme/widgets.git"], { cwd: fixture.root });
	assert.equal((await inspect(fixture)).exitCode, 0);
});
