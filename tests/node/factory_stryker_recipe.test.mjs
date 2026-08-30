import assert from "node:assert/strict";
import test from "node:test";

import { classifyStrykerExit } from "../../scripts/stryker.mjs";


test("the Stryker recipe distinguishes a score failure from an unrunnable tool (§8.2)", () => {
	assert.equal(classifyStrykerExit({ code: 0, signal: null, output: "done" }), 0);
	assert.equal(
		classifyStrykerExit({
			code: 1,
			signal: null,
			output: "Final mutation score 68.22 under breaking threshold 70, setting exit code to 1 (failure).",
		}),
		1,
	);
	assert.equal(classifyStrykerExit({ code: 1, signal: null, output: "Unexpected error occurred" }), 2);
	assert.equal(classifyStrykerExit({ code: null, signal: "SIGTERM", output: "" }), 2);
});
