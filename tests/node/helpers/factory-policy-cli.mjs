// Subprocess fixture composition only. Production factory.mjs does not import
// this file and has no argv/environment channel for relocating the inventory.
import { runCli, renderHuman, renderJson } from "../../../factory/lib/cli/main.mjs";
import { createDesiredPolicyResolver } from "../../../factory/lib/config/policy-resolver.mjs";

const [filesystemRoot, ...argv] = process.argv.slice(2);
const policyResolver = createDesiredPolicyResolver({ filesystemRoot, operatorUid: process.getuid() });
const result = await runCli(argv, { cwd: process.cwd(), policyResolver });
const rendered = result.json ? `${renderJson(result.value)}\n` : renderHuman(result.value);
(result.json || result.value.ok ? process.stdout : process.stderr).write(rendered);
process.exitCode = result.exitCode;
