import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
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
	const activePath = join(activeDirectory, `${repositoryKey(cwd)}.json`);

	async function save(state) {
		await mkdir(runsDirectory, { recursive: true, mode: 0o700 });
		await mkdir(activeDirectory, { recursive: true, mode: 0o700 });
		const runPath = join(runsDirectory, `${state.id}.json`);
		await writeJsonAtomically(runPath, state);
		await writeJsonAtomically(activePath, { id: state.id });
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

	return { save, loadActive };
}
