import { execFile, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const OUTPUT_LIMIT = 64_000;

function subscriptionEnvironment(env) {
	return Object.fromEntries(Object.entries(env).filter(([key]) =>
		!key.startsWith("ANTHROPIC_") && !key.startsWith("CLAUDE_CODE_USE_")));
}

export async function runClaude({ cwd, prompt, sessionId, signal, onProgress = () => {}, onPermission = async () => false, executable = "claude", prefixArgs = [], env = process.env }) {
	if (!prompt?.trim()) throw new Error("A Claude Code task is required.");
	const childEnv = subscriptionEnvironment(env);
	const auth = await execFileAsync(executable, [...prefixArgs, "auth", "status", "--json"], {
		cwd, env: childEnv, signal, timeout: 10_000, maxBuffer: OUTPUT_LIMIT,
	});
	const account = JSON.parse(auth.stdout);
	if (!account.loggedIn || account.authMethod !== "claude.ai" ||
		!['pro', 'max', 'team', 'enterprise'].includes(account.subscriptionType?.toLowerCase()) ||
		(account.apiKeySource && account.apiKeySource !== "none")) {
		throw new Error("Claude Code subscription login required. Run claude auth login, then check /status in Claude Code.");
	}
	signal?.throwIfAborted();
	const args = [...prefixArgs, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--permission-mode", "default"];
	if (sessionId) args.push("--resume", sessionId);
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, { cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"] });
		let result;
		let stderr = "";
		child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = (stderr + chunk).slice(-OUTPUT_LIMIT); });
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			void (async () => {
				const event = JSON.parse(line);
				onProgress(event);
				if (event.type === "control_request") {
					const request = event.request;
					const allowed = request?.subtype === "can_use_tool" && await onPermission(request, signal);
					if (!child.stdin.destroyed && !signal?.aborted) {
						const response = request?.subtype === "can_use_tool"
							? { subtype: "success", request_id: event.request_id, response: allowed
								? { behavior: "allow", updatedInput: request.input }
								: { behavior: "deny", message: "Permission denied by the Pi host." } }
							: { subtype: "error", request_id: event.request_id, error: "Unsupported control request." };
						child.stdin.write(JSON.stringify({ type: "control_response", response }) + "\n");
					}
				}
				if (event.type === "result") {
					result = event;
					child.stdin.end();
				}
			})().catch((error) => {
				child.kill();
				reject(error);
			});
		});
		child.on("error", reject);
		const abort = () => child.kill();
		signal?.addEventListener("abort", abort, { once: true });
		child.on("close", (code) => {
			lines.close();
			signal?.removeEventListener("abort", abort);
			if (signal?.aborted) reject(new Error("Claude Code worker stopped."));
			else if (code !== 0 || !result || result.is_error) reject(new Error(stderr || result?.result || "Claude Code exited without a successful result."));
			else resolve({ sessionId: result.session_id, text: result.result || "" });
		});
		child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: prompt } }) + "\n");
	});
}
