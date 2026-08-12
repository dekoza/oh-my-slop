import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function resolveJobScopePath(cwd) {
  const normalizedCwd = String(cwd ?? '').trim();
  if (!normalizedCwd) {
    return null;
  }

  const resolvedCwd = path.resolve(normalizedCwd);
  try {
    const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: resolvedCwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    return repoRoot.length > 0 ? repoRoot : resolvedCwd;
  } catch {
    return resolvedCwd;
  }
}
