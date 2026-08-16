import test from "node:test";
import assert from "node:assert/strict";

import { attemptBranch } from "../../factory/lib/git/isolation.mjs";

/**
 * §7.3, §2.1: the branch and worktree a factory attempt lives in are **derived
 * deterministically from the minted identity tuple**, and every identity-derived
 * path is contained by charset validation **plus** canonicalize-and-assert-prefix
 * — both, not either.
 */

const RUN = "01JRUN0000000000000000000A";
const ATTEMPT = `${RUN}-t42-a1`;

test("the attempt branch is derived from the tuple, inside the factory/ namespace", () => {
	assert.equal(attemptBranch({ ticket: 42, attempt: ATTEMPT }), `factory/t42/a${ATTEMPT}`);
});
