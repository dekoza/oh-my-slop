import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function getFailoverStorageDir(agentDir) {
	return join(agentDir, 'extensions', 'provider-failover');
}

export function getFailoverConfigPath(agentDir) {
	return join(getFailoverStorageDir(agentDir), 'config.json');
}

export function getFailoverStatePath(agentDir) {
	return join(getFailoverStorageDir(agentDir), 'state.json');
}

export function ensureFailoverStoragePath(filePath) {
	mkdirSync(dirname(filePath), { recursive: true });
}

export function migrateLegacyFile(legacyPath, persistentPath) {
	if (!existsSync(legacyPath) || existsSync(persistentPath)) {
		return false;
	}

	ensureFailoverStoragePath(persistentPath);
	copyFileSync(legacyPath, persistentPath);
	return true;
}
