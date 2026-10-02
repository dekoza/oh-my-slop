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
	if (!account.loggedIn || account.authMethod !== "claude.ai" || account.apiProvider !== "firstParty" ||
		!["pro", "max", "team", "enterprise"].includes(account.subscriptionType?.toLowerCase()) ||
		(account.apiKeySource && account.apiKeySource !== "none")) {
		throw new Error("Claude Code subscription login required. Run claude auth login, then check /status in Claude Code.");
	}
	signal?.throwIfAborted();
	const args = [...prefixArgs, "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--permission-mode", "manual", "--permission-prompt-tool", "stdio", "--permission-prompts", "host"];
	if (sessionId) args.push("--resume", sessionId);
	return new Promise((resolve, reject) => {
		const child = spawn(executable, args, {
			cwd, env: childEnv, stdio: ["pipe", "pipe", "pipe"], detached: process.platform !== "win32",
		});
		let result;
		let failure;
		let killTimer;
		let initialized = false;
		let stderr = "";
		const permissionAbort = new AbortController();
		const kill = (terminationSignal) => {
			try {
				if (process.platform !== "win32" && child.pid) process.kill(-child.pid, terminationSignal);
				else child.kill(terminationSignal);
			} catch (error) {
				if (error.code !== "ESRCH") failure ??= error;
			}
		};
		const stop = () => {
			permissionAbort.abort();
			kill("SIGTERM");
			killTimer ??= setTimeout(() => kill("SIGKILL"), 1_000);
		};
		const fail = (error) => { failure ??= error; stop(); };
		const initializeTimer = setTimeout(() => fail(new Error("Claude Code initialization timed out before the task was sent.")), 10_000);
		child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr = (stderr + chunk).slice(-OUTPUT_LIMIT); });
		const lines = createInterface({ input: child.stdout });
		lines.on("line", (line) => {
			void (async () => {
				const event = JSON.parse(line);
				onProgress(event);
				if (event.type === "control_response" && event.response?.request_id === "pi-initialize") {
					const response = event.response;
					const account = response.response?.account;
					if (initialized) throw new Error("Duplicate Claude Code initialization response.");
					if (response.subtype !== "success" || account?.apiProvider !== "firstParty" ||
						!/^Claude (Pro|Max|Team|Enterprise)$/i.test(account.subscriptionType || "") ||
						(account.apiKeySource && account.apiKeySource !== "none") ||
						(account.tokenSource && account.tokenSource !== "claude.ai")) {
						throw new Error("Claude Code did not initialize with a verified subscription; no task prompt was sent.");
					}
					initialized = true;
					clearTimeout(initializeTimer);
					if (!signal?.aborted) child.stdin.write(JSON.stringify({
						type: "user", session_id: "", message: { role: "user", content: prompt }, parent_tool_use_id: null,
					}) + "\n");
				}
				if (event.type === "control_request") {
					const request = event.request;
					const allowed = request?.subtype === "can_use_tool" && await onPermission(request, permissionAbort.signal);
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
			})().catch(fail);
		});
		child.on("error", fail);
		child.stdin.on("error", fail);
		const abort = stop;
		signal?.addEventListener("abort", abort, { once: true });
		child.on("close", (code) => {
			lines.close();
			clearTimeout(killTimer);
			clearTimeout(initializeTimer);
			permissionAbort.abort();
			signal?.removeEventListener("abort", abort);
			if (failure) reject(failure);
			else if (signal?.aborted) reject(new Error("Claude Code worker stopped."));
			else if (code !== 0 || !result || result.is_error) reject(new Error(stderr || result?.result || "Claude Code exited without a successful result."));
			else resolve({ sessionId: result.session_id, text: result.result || "", permissionDenials: result.permission_denials || [] });
		});
		child.stdin.write(JSON.stringify({ type: "control_request", request_id: "pi-initialize", request: { subtype: "initialize", hooks: null } }) + "\n");
	});
}
