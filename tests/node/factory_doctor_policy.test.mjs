import test from "node:test";
import assert from "node:assert/strict";
import { runCli, renderHuman } from "../../factory/lib/cli/main.mjs";
import { makeRepo } from "./helpers/factory-repo.mjs";

test("doctor --policy refuses conflicting modes before reading any policy", async (t) => {
	const cwd = makeRepo(t, { config: null, remotes: {} });
	for (const args of [["--baseline"], ["23"], ["--parent", "23"]]) {
		const result = await runCli(["doctor", "--policy", ...args, "--json"], { cwd });
		assert.equal(result.exitCode, 1);
		assert.equal(result.value.error.kind, "usage");
		assert.match(renderHuman(result.value), /--policy cannot combine/);
	}
});
