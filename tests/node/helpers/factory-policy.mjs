import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cloneValidConfig, makeRepo } from "./factory-repo.mjs";

// Synthetic identities, selectors and ceilings: not installed operator policy.
export function policyDocuments() {
	const repository = cloneValidConfig();
	const runtime = repository.profiles.builder;
	delete repository.profiles;
	delete repository.concurrency.resources;
	repository.schemaVersion = 3;
	repository.operatorId = "test_operator";
	const operator = {
		schemaVersion: 1, operatorId: "test_operator", controllerHostId: "test_controller",
		resources: { gpu: { identity: { kind: "gpu", hostId: "test_host", deviceId: "test_device" }, enabled: true, limit: 1 } },
		bindings: { local: { resourceId: "gpu", credentialId: null, endpoint: { env: "TEST_INFERENCE_URL", url: "http://inference.invalid:8000" } } },
		credentials: {}, profiles: { builder: { enabled: true, bindingId: "local", runtime } },
		aggregateLimit: 1, modes: { full: { aggregateLimit: 1, resources: { gpu: 1 } }, "local-only": { aggregateLimit: 1, resources: { gpu: 1 } } }, activeMode: "full",
	};
	return { operator, repository };
}

export function policyFixture(t) {
	const documents = policyDocuments();
	const root = makeRepo(t, { config: documents.repository, remotes: { gitea: "https://forge.invalid/acme/widgets.git" } });
	const mount = mkdtempSync(join(tmpdir(), "factory-policy-mount-"));
	t.after(() => rmSync(mount, { recursive: true, force: true }));
	chmodSync(mount, 0o755);
	const operatorFile = join(mount, "operator.json");
	const repositoryFile = join(root, ".pi", "factory.json");
	function save() {
		writeFileSync(operatorFile, JSON.stringify(documents.operator, null, 2), { mode: 0o644 });
		writeFileSync(repositoryFile, JSON.stringify(documents.repository, null, 2));
	}
	save();
	const cwd = join(root, "src", "nested");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "factory.json"), "not the root policy");
	return { ...documents, root, cwd, mount, operatorFile, repositoryFile, save };
}
