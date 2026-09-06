import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { policyFixture } from "./helpers/factory-policy.mjs";

const HARNESS = fileURLToPath(new URL("./helpers/factory-policy-cli.mjs", import.meta.url));

function cliFixture(t) {
	const f = policyFixture(t);
	f.operator.resources.hosted = { identity: { kind: "account", provider: "synthetic", accountId: "test_account", quotaId: "subscription" }, enabled: true, limit: 2 };
	f.operator.credentials.hosted = { kind: "runtime-auth", runtime: "claude", name: "test_auth" };
	f.operator.bindings.hosted = { resourceId: "hosted", credentialId: "hosted", endpoint: null };
	f.operator.profiles.hosted = { enabled: true, bindingId: "hosted", runtime: { kind: "claude", model: "test-model", effort: "high" } };
	f.operator.profiles.dormant = { ...structuredClone(f.operator.profiles.builder), enabled: false };
	f.operator.resources.disabled = { identity: { kind: "account", provider: "synthetic", accountId: "other_account", quotaId: "credits" }, enabled: false, limit: 1 };
	f.operator.credentials.disabled = { kind: "runtime-auth", runtime: "pi", name: "test_disabled_auth" };
	f.operator.bindings.disabled = { resourceId: "disabled", credentialId: "disabled", endpoint: null };
	f.operator.profiles.disabled = { enabled: true, bindingId: "disabled", runtime: { kind: "pi", model: "test-provider/test-model" } };
	f.operator.aggregateLimit = 3;
	f.operator.modes.full = { aggregateLimit: 3, resources: { gpu: 1, hosted: 2, disabled: 1 } };
	f.repository.routing.roles = { implement: "hosted", freshRetry: "hosted", review: ["hosted", "builder"] };
	f.repository.routing.fallbacks = { implement: ["builder"], freshRetry: ["builder"], review: [["builder"], []] };
	f.repository.routing.sets = { local: { roles: { implement: "builder", freshRetry: "builder", review: ["builder", "builder"] }, rules: [] } };
	f.save();
	const bin = join(f.filesystemRoot, "bin");
	mkdirSync(bin);
	// Nonsecret login metadata is the only external read allowed. All other
	// tool invocations fail loudly. No live tracker, authority or model is used.
	const calls = join(f.filesystemRoot, "calls.jsonl");
	writeFileSync(join(bin, "tea"), `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';\nconst args = process.argv.slice(2);\nappendFileSync(${JSON.stringify(calls)}, JSON.stringify(args)+'\\n');\nif (JSON.stringify(args) !== JSON.stringify(['logins','list','--output','json'])) process.exit(99);\nconsole.log(JSON.stringify([{name:'gitea',url:'https://forge.invalid',ssh_host:'forge.invalid'}]));\n`, { mode: 0o755 });
	for (const tool of ["pi", "claude", "herdr", "gh"]) writeFileSync(join(bin, tool), "#!/bin/sh\necho FORBIDDEN_TOOL >&2\nexit 99\n", { mode: 0o755 });
	return { ...f, calls, invoke(args) {
		return spawnSync(process.execPath, [HARNESS, f.filesystemRoot, "doctor", "--policy", ...args], {
			cwd: f.cwd, encoding: "utf8", timeout: 30_000,
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FACTORY_OPERATOR_FILE: "/nonexistent/ignored", FACTORY_MODE: "ignored" },
		});
	} };
}

function snapshot(root) {
	return readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
		.map((e) => [join(e.parentPath, e.name), readFileSync(join(e.parentPath, e.name)).toString("hex")]);
}

test("subprocess CLI explains full/local-only policy and never probes or mutates sources", (t) => {
	const f = cliFixture(t);
	for (const mode of ["full", "local-only"]) {
		f.operator.activeMode = mode;
		f.save();
		const before = snapshot(f.root);
		const operatorBefore = readFileSync(f.operatorFile);
		const json = f.invoke(["--json"]);
		assert.equal(json.status, 0, json.stderr + json.stdout);
		const value = JSON.parse(json.stdout);
		assert.equal(value.schema_version, 1);
		assert.equal(value.command, "doctor");
		const { policy } = value.report.policyResolution;
		assert.equal(policy.operator.activeMode, mode);
		assert.deepEqual(policy.limits, { aggregate: mode === "full" ? 3 : 1, resources: { gpu: 1, hosted: mode === "full" ? 2 : 0, disabled: 0 } });
		assert.deepEqual(policy.profileAvailability, { builder: "enabled", hosted: mode === "full" ? "enabled" : "mode-disabled", dormant: "profile-disabled", disabled: "resource-disabled" });
		const human = f.invoke([]);
		assert.equal(human.status, 0, human.stderr);
		assert.ok(human.stdout.includes(`configured eligible profiles: ${mode === "full" ? "builder, hosted" : "builder"} (`));
		assert.match(human.stdout, /applied state: not observed/);
		assert.match(human.stdout, /occupancy: not observed/);
		assert.doesNotMatch(human.stderr, /FORBIDDEN_TOOL/);
		assert.deepEqual(snapshot(f.root), before);
		assert.deepEqual(readFileSync(f.operatorFile), operatorBefore);
	}
	assert.deepEqual(readFileSync(f.calls, "utf8").trim().split("\n").map(JSON.parse), Array(4).fill(["logins", "list", "--output", "json"]));
});

for (const scope of ["operator", "repository"]) {
	for (const [open, close] of [["[", "]"], ['{"nested":', "}"]]) {
		test(`subprocess CLI safely refuses deeply nested ${scope} policy (${open})`, (t) => {
			const f = cliFixture(t);
			const file = scope === "operator" ? f.operatorFile : join(f.root, ".pi", "factory.json");
			const valid = readFileSync(file, "utf8").trim().slice(0, -1);
			for (const depth of [10, 5000]) {
				const source = `${valid},"NEVER_DISCLOSE_DEEP_KEY":${open.repeat(depth)}"NEVER_DISCLOSE_DEEP_VALUE"${close.repeat(depth)}}`;
				writeFileSync(file, source);
				const result = f.invoke(["--json"]);
				assert.equal(result.status, 1, result.stderr);
				assert.doesNotMatch(result.stderr, /RangeError|call stack/);
				const value = JSON.parse(result.stdout);
				const resolution = value.error.policyResolution;
				assert.equal(resolution.state, "rejected");
				assert.equal(resolution.policy, null);
				assert.equal(value.error.reason, "invalid-document");
				assert.equal(resolution.rejection.code, "invalid-document");
				assert.equal(resolution.rejection.scope, scope);
				assert.match(resolution.desiredRevision, /^[a-f0-9]{64}$/);
				const human = f.invoke([]);
				assert.equal(human.status, 1);
				assert.equal(human.stdout, "");
				assert.ok(human.stderr.includes(resolution.rejection.code));
				assert.doesNotMatch(result.stdout + result.stderr + human.stderr, /NEVER_DISCLOSE|RangeError|call stack/);
				assert.equal(readFileSync(file, "utf8"), source);
			}
		});
	}
}

for (const field of ["credentialId", "name"]) {
	test(`subprocess CLI safely diagnoses deeply nested credential ${field}`, (t) => {
		const f = cliFixture(t);
		const target = field === "credentialId" ? f.operator.bindings.hosted : f.operator.credentials.hosted;
		target[field] = "DEEP_PLACEHOLDER";
		const nested = `${"[".repeat(10000)}"NEVER_DISCLOSE_CREDENTIAL"${"]".repeat(10000)}`;
		writeFileSync(f.operatorFile, JSON.stringify(f.operator).replace('"DEEP_PLACEHOLDER"', nested));
		const result = f.invoke(["--json"]);
		assert.equal(result.status, 1);
		assert.doesNotMatch(result.stderr, /RangeError|call stack/);
		const value = JSON.parse(result.stdout);
		assert.equal(value.error.reason, "invalid-document");
		assert.equal(value.error.policyResolution.state, "rejected");
		assert.equal(value.error.policyResolution.policy, null);
		assert.equal(value.error.policyResolution.rejection.scope, "operator");
		assert.doesNotMatch(result.stdout + result.stderr, /NEVER_DISCLOSE/);
	});
}

for (const field of ["timeout", "name", "severity"]) {
	test(`subprocess CLI safely refuses deeply nested repository check ${field}`, (t) => {
		const f = cliFixture(t);
		f.repository.checks[0][field] = "DEEP_PLACEHOLDER";
		for (const [open, close] of [["[", "]"], ['{"nested":', "}"]]) {
			const nested = `${open.repeat(10000)}"NEVER_DISCLOSE_CHECK"${close.repeat(10000)}`;
			writeFileSync(f.repositoryFile, JSON.stringify(f.repository).replace('"DEEP_PLACEHOLDER"', nested));
			const result = f.invoke(["--json"]);
			assert.equal(result.status, 1);
			assert.doesNotMatch(result.stderr, /RangeError|call stack/);
			const value = JSON.parse(result.stdout);
			assert.equal(value.error.reason, "invalid-document");
			assert.equal(value.error.policyResolution.state, "rejected");
			assert.equal(value.error.policyResolution.policy, null);
			assert.equal(value.error.policyResolution.rejection.scope, "repository");
			const human = f.invoke([]);
			assert.equal(human.status, 1);
			assert.equal(human.stdout, "");
			assert.match(human.stderr, /invalid-document/);
			assert.doesNotMatch(result.stdout + result.stderr + human.stderr, /NEVER_DISCLOSE|RangeError|call stack/);
		}
	});
}

test("subprocess CLI records selected routing and a rejected revision without disclosing invalid bytes", (t) => {
	const f = cliFixture(t);
	const selected = f.invoke(["--routing-set=local", "--json"]);
	assert.equal(selected.status, 0, selected.stderr);
	assert.equal(JSON.parse(selected.stdout).report.policyResolution.policy.routingSet, "local");
	writeFileSync(f.operatorFile, '{"token":"NEVER_DISCLOSE_THIS",');
	const result = f.invoke(["--json"]);
	assert.equal(result.status, 1, result.stderr);
	const value = JSON.parse(result.stdout);
	assert.equal(value.error.reason, "invalid-document");
	assert.equal(value.error.policyResolution.state, "rejected");
	assert.equal(value.error.policyResolution.policy, null);
	const human = f.invoke([]);
	assert.equal(human.status, 1);
	assert.equal(human.stdout, "");
	assert.match(human.stderr, /invalid-document/);
	assert.doesNotMatch(result.stdout + result.stderr + human.stderr, /NEVER_DISCLOSE_THIS/);
});
