import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function parseStorageMode(value) {
  if (value !== "shared" && value !== "project") {
    return undefined;
  }
  return value;
}

export function expandHomeDir(inputPath, homeDir = homedir()) {
  if (inputPath === "~") {
    return homeDir;
  }

  if (inputPath.startsWith("~/") || inputPath.startsWith(`~${path.sep}`)) {
    return path.join(homeDir, inputPath.slice(2));
  }

  return inputPath;
}

export function resolvePiAgentDir(env = process.env, homeDir = homedir()) {
  const override = env.PI_CODING_AGENT_DIR?.trim();
  if (override) {
    return path.resolve(expandHomeDir(override, homeDir));
  }

  return path.join(homeDir, ".pi", "agent");
}

export function getMirroredWorkspacePathSegments(cwd) {
  const resolved = path.resolve(cwd);
  const parsed = path.parse(resolved);
  const relativeSegments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
  const rootSegment = parsed.root
    ? parsed.root.replaceAll(/[^a-zA-Z0-9]+/g, "-").replaceAll(/^-+|-+$/g, "").toLowerCase() || "root"
    : "root";

  return [rootSegment, ...relativeSegments];
}

export function resolveSubagentStorageOptions({
  env = process.env,
  homeDir = homedir(),
  configPath,
  piAgentDir,
} = {}) {
  const resolvedPiAgentDir = piAgentDir ?? resolvePiAgentDir(env, homeDir);
  const resolvedConfigPath = configPath ?? path.join(resolvedPiAgentDir, "extensions", "subagent", "config.json");

  let config = {};
  if (existsSync(resolvedConfigPath)) {
    const parsed = JSON.parse(readFileSync(resolvedConfigPath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`Invalid subagent config at ${resolvedConfigPath}`);
    }
    config = parsed;
  }

  const configMode = parseStorageMode(config.projectAgentStorageMode);
  const envMode = parseStorageMode(env.PI_SUBAGENT_PROJECT_AGENTS_MODE?.trim());
  const mode = envMode ?? configMode ?? "shared";

  const sharedRootRaw =
    env.PI_SUBAGENT_PROJECT_AGENTS_ROOT?.trim() ||
    (typeof config.projectAgentSharedRoot === "string" && config.projectAgentSharedRoot.trim()) ||
    path.join(resolvedPiAgentDir, "subagents", "project-agents");

  return {
    mode,
    sharedRoot: path.resolve(expandHomeDir(sharedRootRaw, homeDir)),
    piAgentDir: resolvedPiAgentDir,
    configPath: resolvedConfigPath,
  };
}

export function resolveProjectAgentsDir(cwd, options = {}) {
  const resolved = resolveSubagentStorageOptions(options);
  if (resolved.mode === "project") {
    return path.join(path.resolve(cwd), ".pi", "agents");
  }

  return path.join(resolved.sharedRoot, ...getMirroredWorkspacePathSegments(cwd), "agents");
}

export function listBundledAgentFiles(sourceDir) {
  if (!existsSync(sourceDir)) {
    return [];
  }

  return readdirSync(sourceDir, { withFileTypes: true })
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md") && !entry.name.endsWith(".chain.md"))
    .map((entry) => path.join(sourceDir, entry.name))
    .sort();
}

export function seedBundledAgents({
  cwd,
  sourceDir,
  env = process.env,
  homeDir = homedir(),
  configPath,
  piAgentDir,
}) {
  const targetDir = resolveProjectAgentsDir(cwd, { env, homeDir, configPath, piAgentDir });
  const sourceFiles = listBundledAgentFiles(sourceDir);

  if (sourceFiles.length === 0) {
    return { targetDir, seeded: [], skipped: [] };
  }

  mkdirSync(targetDir, { recursive: true });

  const seeded = [];
  const skipped = [];

  for (const sourcePath of sourceFiles) {
    const targetPath = path.join(targetDir, path.basename(sourcePath));
    if (existsSync(targetPath)) {
      skipped.push(targetPath);
      continue;
    }

    copyFileSync(sourcePath, targetPath);
    seeded.push(targetPath);
  }

  return { targetDir, seeded, skipped };
}
