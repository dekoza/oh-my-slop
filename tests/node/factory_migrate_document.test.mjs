import test from "node:test";
import assert from "node:assert/strict";

import { CONFIG_SCHEMA_VERSION } from "../../factory/lib/config/load.mjs";
import { LEGACY_SCHEMA_VERSION, migrateDocument } from "../../factory/lib/migrate/document.mjs";
import { cloneLegacyConfig } from "./helpers/factory-repo.mjs";

function migrate(overrides = {}, options = {}) {
	return migrateDocument({ ...cloneLegacyConfig(), ...overrides }, options);
}

function rowFor(dispositions, from) {
	const row = dispositions.find((candidate) => candidate.from === from);
	assert.ok(row !== undefined, `no disposition row for "${from}"; got ${dispositions.map((r) => r.from).join(", ")}`);
	return row;
}

// ── The version itself (§11.8) ───────────────────────────────────────────────

test("§11.8: a v1 document becomes a schemaVersion 2 document, and the version is reported", () => {
	const { document, dispositions } = migrate();

	assert.equal(LEGACY_SCHEMA_VERSION, 1);
	assert.equal(document.schemaVersion, CONFIG_SCHEMA_VERSION);
	assert.equal(document.version, undefined);
	assert.equal(rowFor(dispositions, "version").disposition, "mapped");
	assert.equal(rowFor(dispositions, "version").to, "schemaVersion");
});

test("§11.8: a document that is not v1 refuses rather than being migrated twice", () => {
	assert.throws(() => migrate({ version: undefined, schemaVersion: 2 }), {
		name: "FactoryConfigError",
		reason: "schema-version",
	});
});

// ── Mapped keys (§11.8's first row) ──────────────────────────────────────────

test("§11.8: tracker survives minus its labels, which are reported and dropped", () => {
	const { document, dispositions } = migrate();

	assert.deepEqual(document.tracker, {
		kind: "gitea",
		repo: "acme/widgets",
		remote: "gitea",
		login: "gitea",
		assignee: "factory-bot",
	});
	assert.equal(rowFor(dispositions, "tracker").disposition, "mapped");
	assert.equal(rowFor(dispositions, "tracker.labels").disposition, "dropped");
});

test("§11.8: git carries over whole", () => {
	const { document, dispositions } = migrate();

	assert.deepEqual(document.git, { baseBranch: "main", remote: "gitea" });
	assert.equal(rowFor(dispositions, "git").disposition, "mapped");
});
