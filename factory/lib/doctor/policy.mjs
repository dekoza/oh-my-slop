import { realpathSync } from "node:fs";
import { discoverConfigPath } from "../config/discover.mjs";
import { loadFactoryConfig } from "../config/load.mjs";
import { assertPolicyRequest, assertPolicyResolution } from "../config/operator-policy-v1.mjs";
import { createDesiredPolicyResolver } from "../config/policy-resolver.mjs";

export const POLICY_FLAG = "--policy";

/** §11.9 selects a distinct, fail-closed loader, not a lenient v2 load. */
export async function loadDoctorConfig(invocation) {
	if (invocation.flags.includes(POLICY_FLAG)) {
		if (invocation.args.length > 0 || invocation.flags.some((flag) => ["--baseline", "--parent"].includes(flag))) {
			return { policyInspection: {
				exitCode: 1,
				error: { kind: "usage", message: "--policy cannot combine with --baseline or ticket/parent scope selectors." },
			} };
		}
		const { repoRoot } = discoverConfigPath(invocation.cwd);
		const request = { contractVersion: 1, repositoryRoot: realpathSync(repoRoot), routingSet: invocation.routingSet, view: "desired" };
		try { assertPolicyRequest(request); } catch (error) {
			if (!(error instanceof TypeError)) throw error;
			return { policyInspection: { exitCode: 1, error: { kind: "usage", message: "Use a valid policy routing-set identifier." } } };
		}
		const resolver = invocation.policyResolver ?? createDesiredPolicyResolver();
		const policyResolution = await resolver.resolve(request);
		assertPolicyResolution(policyResolution, request);
		const observations = "applied state: not observed; occupancy: not observed; deployment enforcement: not observed; provider capability: not observed";
		const policyInspection = policyResolution.state === "preview"
			? { message: `Desired policy preview; all limits are configured ceilings, not free slots. ${observations}.`, report: { policyResolution } }
			: { exitCode: 1, error: { kind: "config-load", reason: policyResolution.rejection.code,
				message: `${policyResolution.rejection.scope} policy refused at ${policyResolution.rejection.at}. ${policyResolution.rejection.question ?? "Correct the policy source."} ${observations}.`, policyResolution } };
		return { policyInspection };
	}
	return loadFactoryConfig(invocation);
}
