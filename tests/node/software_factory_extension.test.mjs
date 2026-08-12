import test from "node:test";
import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

async function createHarness() {
	const root = await mkdtemp(join(tmpdir(), "software-factory-extension-"));
	const extensionRoot = join(root, "extensions", "software-factory");
	await mkdir(join(root, "extensions"), { recursive: true });
	await cp(join(process.cwd(), "extensions", "software-factory"), extensionRoot, { recursive: true });
	const packageRoot = join(root, "node_modules", "@earendil-works", "pi-coding-agent");
	await mkdir(packageRoot, { recursive: true });
	await writeFile(join(packageRoot, "package.json"), JSON.stringify({
		name: "@earendil-works/pi-coding-agent",
		type: "module",
		exports: "./index.js",
	}));
	await writeFile(join(packageRoot, "index.js"), 'export const CONFIG_DIR_NAME = ".pi";\n');
	return { root, extensionRoot };
}

test("software-factory extension registers one command with start and status guidance", async () => {
	const { root, extensionRoot } = await createHarness();
	const module = await import(`${pathToFileURL(join(extensionRoot, "index.ts")).href}?t=${Date.now()}`);
	const commands = new Map();
	const pi = {
		registerCommand(name, definition) { commands.set(name, definition); },
		exec: async () => ({ code: 0, stdout: "", stderr: "" }),
	};
	module.default(pi);

	assert.deepEqual([...commands.keys()], ["factory"]);
	assert.match(commands.get("factory").description, /start <parent-ticket>/);

	const notifications = [];
	await commands.get("factory").handler("status", {
		cwd: root,
		isProjectTrusted: () => true,
		ui: {
			notify(message, level) { notifications.push([message, level]); },
			setStatus() {},
		},
	});
	assert.deepEqual(notifications, [["No factory run is recorded for this repository.", "info"]]);
});
