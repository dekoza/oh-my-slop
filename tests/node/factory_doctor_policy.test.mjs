import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { runCli, renderHuman } from "../../factory/lib/cli/main.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";
import { policyFixture } from "./helpers/factory-policy.mjs";
import { createHash } from "node:crypto";
import { chmodSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

async function inspect(fixture, args = [], login = { url: "https://forge.invalid", sshHost: "forge.invalid" }) {
	const { createDesiredPolicyResolver } = await import("../../factory/lib/config/policy-resolver.mjs");
	const policyResolver = createDesiredPolicyResolver({
		filesystemRoot: fixture.filesystemRoot, operatorUid: process.getuid(),
		readLogin: async () => login,
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
	for (const url of ["https://other.invalid/acme/widgets.git", "https://forge.invalid/acme/other.git", "ssh://git@forge.invalid:2222/acme/widgets.git", "https://forge.invalid/unrelated/acme/widgets.git", "ssh://git@forge.invalid/unrelated/acme/widgets.git"]) {
		execFileSync("git", ["remote", "set-url", "gitea", url], { cwd: fixture.root });
		const result = await inspect(fixture);
		assert.equal(result.exitCode, 1, url);
		assert.equal(result.value.error.reason, "identity-mismatch");
	}
	execFileSync("git", ["remote", "set-url", "gitea", "git@forge.invalid:acme/widgets.git"], { cwd: fixture.root });
	assert.equal((await inspect(fixture)).exitCode, 0);
});

test("a forge HTTP base path is exact and does not become an SSH repository prefix", async (t) => {
	const f = policyFixture(t);
	const login = { url: "https://forge.invalid/gitea", sshHost: "forge.invalid:2222" };
	for (const [url, exitCode] of [
		["https://forge.invalid/gitea/acme/widgets.git", 0],
		["ssh://git@forge.invalid:2222/acme/widgets.git", 0],
		["https://forge.invalid/gitea/unrelated/acme/widgets.git", 1],
		["ssh://git@forge.invalid:2222/gitea/acme/widgets.git", 1],
	]) {
		execFileSync("git", ["remote", "set-url", "gitea", url], { cwd: f.root });
		assert.equal((await inspect(f, [], login)).exitCode, exitCode, url);
	}
});

test("repository provenance cannot name a local policy while reading through an escaping .pi symlink", async (t) => {
	const f = policyFixture(t);
	const outside = join(f.filesystemRoot, "foreign-policy");
	renameSync(join(f.root, ".pi"), outside);
	symlinkSync(outside, join(f.root, ".pi"));
	const result = await inspect(f);
	assert.equal(result.exitCode, 1);
	assert.equal(result.value.error.reason, "ownership-conflict");
	assert.equal(result.value.error.policyResolution.rejection.scope, "repository");
	assert.equal(result.value.error.policyResolution.policy, null);
});

test("a dormant resource named constructor has zero configured capacity, not an inherited property", async (t) => {
	const f = policyFixture(t);
	f.operator.resources.constructor = { identity: { kind: "gpu", hostId: "test_host", deviceId: "other_device" }, enabled: true, limit: 1 };
	f.save();
	const result = await inspect(f);
	assert.equal(result.exitCode, 0);
	assert.deepEqual(result.value.report.policyResolution.policy.limits.resources, { gpu: 1, constructor: 0 });
});

test("a replaceable operator mount refuses rather than blessing repository-writable inventory", async (t) => {
	const fixture = policyFixture(t);
	chmodSync(dirname(fixture.mount), 0o777);
	const result = await inspect(fixture);
	assert.equal(result.exitCode, 1);
	assert.equal(result.value.error.reason, "boundary-unproven");
});

test("source revisions track bytes and selection, while missing and symlinked sources expose no policy", async (t) => {
	const f = policyFixture(t);
	const first = (await inspect(f)).value.report.policyResolution;
	writeFileSync(f.operatorFile, `${readFileSync(f.operatorFile, "utf8")}\n`);
	const whitespace = (await inspect(f)).value.report.policyResolution;
	assert.notEqual(first.desiredRevision, whitespace.desiredRevision);
	assert.deepEqual(first.policy.operator, whitespace.policy.operator);
	assert.ok(Object.isFrozen(whitespace.policy.operator.profiles.builder.runtime));
	f.repository.routing.sets = { local: structuredClone(f.repository.routing) };
	f.repository.routing.activeSet = "local";
	f.save();
	const implicit = (await inspect(f)).value.report.policyResolution;
	const explicit = (await inspect(f, ["--routing-set=local"])).value.report.policyResolution;
	assert.equal(implicit.policy.routingSet, "local");
	assert.equal(explicit.policy.routingSet, "local");
	assert.notEqual(implicit.desiredRevision, explicit.desiredRevision);
	renameSync(f.operatorFile, `${f.operatorFile}.saved`);
	const missing = (await inspect(f)).value.error.policyResolution;
	assert.equal(missing.state, "unavailable");
	assert.equal(missing.rejection.code, "source-unavailable");
	assert.equal(missing.policy, null);
	assert.equal(missing.appliedRevision, null);
	symlinkSync(`${f.operatorFile}.saved`, f.operatorFile);
	const symlink = (await inspect(f)).value.error.policyResolution;
	assert.equal(symlink.state, "unavailable");
	assert.notEqual(symlink.desiredRevision, missing.desiredRevision);
});

test("unknown references and ownership conflicts are checked in dormant entries and alternate shapes", async (t) => {
	for (const [code, mutate] of [
		["unknown-reference", (f) => { f.operator.modes.dormant = { aggregateLimit: 1, resources: { missing: 1 } }; }],
		["unknown-reference", (f) => { f.repository.routing.sets = { dormant: { roles: { ...f.repository.routing.roles, implement: "missing" }, rules: [] } }; }],
		["unknown-reference", (f) => { f.repository.routing.fallbacks = { implement: ["missing"] }; }],
		["ownership-conflict", (f) => { f.repository.worker = { piExtensions: [{ path: "/test/extension", env: { TEST_INFERENCE_URL: "http://other.invalid" } }] }; }],
		["invalid-document", (f) => { f.operator.profiles.builder.runtime.token = "NEVER_DISCLOSE_THIS"; }],
	]) {
		const f = policyFixture(t);
		mutate(f);
		f.save();
		const result = await inspect(f);
		assert.equal(result.value.error.reason, code);
		assert.doesNotMatch(JSON.stringify(result.value), /NEVER_DISCLOSE_THIS/);
	}
});
