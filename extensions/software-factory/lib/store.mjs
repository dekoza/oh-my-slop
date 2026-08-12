import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

function repositoryKey(cwd) {
	return createHash("sha256").update(resolve(cwd)).digest("hex").slice(0, 20);
}

async function writeJsonAtomically(path, value) {
	const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
	await rename(temporaryPath, path);
}

export function createRunStore({ root, cwd }) {
	const runsDirectory = join(root, "runs");
	const activeDirectory = join(root, "active");
	const key = repositoryKey(cwd);
	const activePath = join(activeDirectory, `${key}.json`);
	const lockPath = join(activeDirectory, `${key}.lock`);

	async function save(state) {
		await mkdir(runsDirectory, { recursive: true, mode: 0o700 });
		await mkdir(activeDirectory, { recursive: true, mode: 0o700 });
		const runPath = join(runsDirectory, `${state.id}.json`);
		await writeJsonAtomically(runPath, state);
		await writeJsonAtomically(activePath, { id: state.id });
	}

	async function acquire(runId) {
		await mkdir(activeDirectory, { recursive: true, mode: 0o700 });
		try {
			const handle = await open(lockPath, "wx", 0o600);
			try {
				await handle.writeFile(`${JSON.stringify({ runId, pid: process.pid })}\n`);
			} finally {
				await handle.close();
			}
		} catch (error) {
			if (error?.code !== "EEXIST") throw error;
			let owner = "an unknown run";
			try {
				owner = JSON.parse(await readFile(lockPath, "utf8")).runId ?? owner;
			} catch {
				// A malformed lock still protects the repository; do not guess that it is stale.
			}
			throw new Error(`This repository is already locked by ${owner}.`);
		}
	}

	async function release(runId) {
		let owner;
		try {
			owner = JSON.parse(await readFile(lockPath, "utf8")).runId;
		} catch (error) {
			if (error?.code === "ENOENT") return;
			throw error;
		}
		if (owner !== runId) {
			throw new Error(`Refusing to release a factory lock owned by ${owner}.`);
		}
		await unlink(lockPath);
	}

	async function loadActive() {
		try {
			const pointer = JSON.parse(await readFile(activePath, "utf8"));
			return JSON.parse(await readFile(join(runsDirectory, `${pointer.id}.json`), "utf8"));
		} catch (error) {
			if (error?.code === "ENOENT") return undefined;
			throw error;
		}
	}

	return { save, loadActive, acquire, release };
}
