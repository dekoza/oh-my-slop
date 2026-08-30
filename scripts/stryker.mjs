#!/usr/bin/env node

import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const BREAKING_SCORE = /Final mutation score .* under breaking threshold .*setting exit code to 1/;

/**
 * Preserve Stryker's score failure as product evidence while mapping every
 * indistinguishable process failure to an exit outside the declared contract.
 */
export function classifyStrykerExit({ code, signal, output }) {
	if (signal !== null || (code !== 0 && code !== 1)) return 2;
	if (code === 0) return 0;
	return BREAKING_SCORE.test(output) ? 1 : 2;
}

export async function runStryker() {
	const child = spawn("npx", ["--yes", "@stryker-mutator/core@10.0.0", "run"], {
		stdio: ["ignore", "pipe", "pipe"],
	});
	let output = "";
	child.stdout.setEncoding("utf8");
	child.stderr.setEncoding("utf8");
	child.stdout.on("data", (chunk) => {
		output += chunk;
		process.stdout.write(chunk);
	});
	child.stderr.on("data", (chunk) => {
		output += chunk;
		process.stderr.write(chunk);
	});

	return await new Promise((resolve) => {
		let spawnFailed = false;
		child.once("error", (error) => {
			spawnFailed = true;
			process.stderr.write(`Stryker could not start: ${error.message}\n`);
			resolve(2);
		});
		child.once("close", (code, signal) => {
			if (!spawnFailed) resolve(classifyStrykerExit({ code, signal, output }));
		});
	});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = await runStryker();
}
