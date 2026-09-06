import { loadFactoryConfig } from "../config/load.mjs";

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
	}
	return loadFactoryConfig(invocation);
}
