import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createRunStore } from "../../extensions/software-factory/lib/store.mjs";

test("run store atomically persists and reloads the active run for one repository", async () => {
	const root = await mkdtemp(join(tmpdir(), "software-factory-store-"));
	const store = createRunStore({ root, cwd: "/projects/example" });
	const state = {
		id: "factory-a1",
		cwd: "/projects/example",
		parentIndex: 9,
		status: "running",
		completed: [10],
	};

	await store.save(state);

	assert.deepEqual(await store.loadActive(), state);
});

test("run store returns undefined when a repository has no active run", async () => {
	const root = await mkdtemp(join(tmpdir(), "software-factory-store-empty-"));
	const store = createRunStore({ root, cwd: "/projects/other" });

	assert.equal(await store.loadActive(), undefined);
});
