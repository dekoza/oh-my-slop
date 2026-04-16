import { existsSync, readFileSync } from "node:fs";

export type NormalizedConfigResult<T> = {
	value: T;
	warnings?: string[];
};

export type LoadJsonConfigFileParams<T> = {
	path: string;
	fallback: T;
	normalize: (raw: unknown) => NormalizedConfigResult<T>;
	warn: (message: string) => void;
};

export function loadJsonConfigFile<T>({
	path,
	fallback,
	normalize,
	warn,
}: LoadJsonConfigFileParams<T>): T {
	const fallbackValue = structuredClone(fallback);

	if (!existsSync(path)) {
		return fallbackValue;
	}

	try {
		const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
		const normalized = normalize(raw);
		for (const message of normalized.warnings ?? []) {
			warn(message);
		}
		return normalized.value;
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		warn(`Failed to load ${path}: ${message}. Using fallback.`);
		return fallbackValue;
	}
}
