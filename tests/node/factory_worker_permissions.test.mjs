import assert from "node:assert/strict";
import test from "node:test";

import { FactoryWorkerError } from "../../factory/lib/worker/errors.mjs";
import {
	claudeSessionArguments,
	claudeSettingsDocument,
	DENY_FLOOR,
	mergeDenies,
	NO_MID_ATTEMPT_APPROVALS,
	PI_GATING_CAVEAT,
	piSessionArguments,
	WORKER_POSTURES,
} from "../../factory/lib/worker/permissions.mjs";

/**
 * §6.8's postures: allow-by-default with an override-proof deny floor for the
 * builder, the same non-interactive mode with edit tools withheld for the
 * reviewer, and no prompt path in either — `acceptEdits`, interactive plan
 * approval, and full bypass are refused by construction.
 */

test("the deny floor covers push, tea, and gh in every spelling Claude's matcher accepts", () => {
	for (const verb of ["git push", "tea", "gh"]) {
		const covering = DENY_FLOOR.filter((rule) => rule.startsWith(`Bash(${verb}`));
		assert.ok(covering.length >= 2, `${verb} is spelled ${covering.length} way(s): ${covering.join(", ")}`);
		assert.ok(covering.includes(`Bash(${verb}:*)`), `${verb} lacks the documented prefix form`);
	}
});

test("per-run overrides add denies and the floor always survives the merge", () => {
	const merged = mergeDenies(["Bash(curl:*)", "WebFetch"]);

	for (const rule of DENY_FLOOR) assert.ok(merged.includes(rule), `${rule} fell out of the merge`);
	assert.ok(merged.includes("Bash(curl:*)") && merged.includes("WebFetch"));
	// Declared twice, or declaring a floor rule again, is not two rules.
	assert.equal(new Set(merged).size, merged.length);
});

test("a declared deny that is really a subtraction is refused by shape", () => {
	for (const attempt of ["!Bash(git push:*)", "-Bash(tea:*)", "allow:Bash(gh:*)", ""]) {
		assert.throws(
			() => mergeDenies([attempt]),
			(error) => {
				assert.ok(error instanceof FactoryWorkerError);
				assert.equal(error.reason, "permission-invalid");
				return true;
			},
			`${JSON.stringify(attempt)} was accepted as a deny rule`,
		);
	}
});

test("an override may never re-enable what the floor denies", () => {
	assert.throws(
		() => mergeDenies(["Bash(git push --force:*)"], { allow: ["Bash(git push:*)"] }),
		(error) => {
			assert.equal(error.reason, "deny-floor-subtracted");
			assert.match(error.message, /never subtract/i);
			return true;
		},
	);
});

test("the builder binding is dontAsk plus broad allows plus the floor — never acceptEdits, never bypass", () => {
	const settings = claudeSettingsDocument({ posture: WORKER_POSTURES.builder, extraDenies: [] });
	const args = claudeSessionArguments({ posture: WORKER_POSTURES.builder, settingsPath: "/s.json" });

	assert.equal(settings.permissions.defaultMode, "dontAsk");
	// Broad tool families, not a per-command allowlist: a strict allowlist is the
	// reliability trap §6.8 rejects.
	assert.ok(settings.permissions.allow.includes("Bash"));
	assert.ok(settings.permissions.allow.every((rule) => !rule.includes("(")));
	for (const rule of DENY_FLOOR) assert.ok(settings.permissions.deny.includes(rule));

	assert.deepEqual(args.slice(0, 4), ["--settings", "/s.json", "--permission-mode", "dontAsk"]);
	assert.ok(!args.includes("acceptEdits"));
	assert.ok(!args.some((argument) => argument.includes("dangerously")));
});

test("the reviewer binding cannot enter interactive plan approval and still disallows edit tools", () => {
	const settings = claudeSettingsDocument({ posture: WORKER_POSTURES.reviewer, extraDenies: [] });
	const args = claudeSessionArguments({ posture: WORKER_POSTURES.reviewer, settingsPath: "/s.json" });

	// Claude Code's plan mode writes a plan through Write and then asks for
	// ExitPlanMode approval. With Write deliberately absent and nobody watching
	// the pane, that workflow cannot finish; the reviewer must be non-interactive.
	assert.equal(settings.permissions.defaultMode, "dontAsk");
	for (const tool of ["Edit", "Write", "NotebookEdit"]) {
		assert.ok(settings.permissions.deny.includes(tool), `${tool} is not denied in settings`);
		assert.ok(!settings.permissions.allow.includes(tool), `${tool} is allowed as well as denied`);
	}
	// An empty allow list would leave a prompt path in the one posture that was
	// not given broad allows — a pane hanging on an approval nobody watches.
	assert.ok(settings.permissions.allow.includes("Bash"), "a reviewer cannot read a diff or write its outbox without Bash");
	assert.ok(settings.permissions.allow.includes("Read"));
	assert.deepEqual(args.slice(2), ["--permission-mode", "dontAsk", "--disallowedTools", "Edit,Write,NotebookEdit"]);
});

test("pi is tool lists only: the builder withholds nothing, the reviewer loses edit and write but keeps bash", () => {
	assert.deepEqual(piSessionArguments({ posture: WORKER_POSTURES.builder }), []);

	const reviewer = piSessionArguments({ posture: WORKER_POSTURES.reviewer });
	assert.deepEqual(reviewer, ["--exclude-tools", "edit,write"]);
	assert.ok(!reviewer.join(" ").includes("bash"));
});

test("an unknown posture is refused rather than defaulted to the permissive one", () => {
	for (const build of [claudeSettingsDocument, claudeSessionArguments, piSessionArguments]) {
		assert.throws(
			() => build({ posture: "auto", settingsPath: "/s.json", extraDenies: [] }),
			(error) => {
				assert.equal(error.reason, "permission-invalid");
				return true;
			},
		);
	}
});

test("the two sentences the prompt template and the manifest have to carry are stated once", () => {
	assert.match(NO_MID_ATTEMPT_APPROVALS, /risky-action-required/);
	assert.match(NO_MID_ATTEMPT_APPROVALS, /needs-human/);
	assert.match(PI_GATING_CAVEAT, /no command-level permission system/);
});
