import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function getJobBranchName(jobId) {
  return `job/${jobId}`;
}

export function gitBranchExists(repoRoot, branchName) {
  try {
    execSync(`git show-ref --verify refs/heads/${branchName}`, {
      cwd: repoRoot,
      stdio: 'pipe',
    });
    return true;
  } catch {
    return false;
  }
}

export function deleteJobBranch(repoRoot, jobId, { force = true } = {}) {
  execSync(`git branch ${force ? '-D' : '-d'} ${getJobBranchName(jobId)}`, {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

/**
 * Create a git worktree at `.worktrees/<jobId>/` relative to the repository
 * root. The worktree is checked out on a new branch named `job/<jobId>`.
 *
 * @param {string} repoRoot   Absolute path to the git repository root.
 * @param {string} jobId      Unique job identifier.
 * @returns {string}          Absolute path to the created worktree.
 * @throws {Error}            If git commands fail.
 */
export function createWorktree(repoRoot, jobId) {
  const worktreesBase = join(repoRoot, '.worktrees');
  mkdirSync(worktreesBase, { recursive: true });

  const worktreePath = join(worktreesBase, jobId);
  if (existsSync(worktreePath)) {
    throw new Error(`Worktree already exists at ${worktreePath}. Resume the existing job or clean it up first.`);
  }

  const branchName = getJobBranchName(jobId);
  execSync(`git worktree add -b ${branchName} ${worktreePath}`, {
    cwd: repoRoot,
    stdio: 'pipe',
  });

  return worktreePath;
}

/**
 * Merge the worktree branch back into the current branch (HEAD of the main
 * worktree), then remove the worktree and delete the branch.
 *
 * Proofs are preserved by the caller before this is called.
 *
 * @param {string} repoRoot
 * @param {string} jobId
 * @param {string} worktreePath
 */
export function mergeAndCleanWorktree(repoRoot, jobId, worktreePath) {
  const branchName = getJobBranchName(jobId);

  // Commit any uncommitted changes in the worktree before merging.
  try {
    execSync('git add -A && git diff --cached --quiet || git commit -m "chore: job pipeline final state"', {
      cwd: worktreePath,
      stdio: 'pipe',
      shell: true,
    });
  } catch {
    // Nothing staged — that's fine.
  }

  execSync(`git merge --no-ff ${branchName} -m "feat: merge job ${jobId}"`, {
    cwd: repoRoot,
    stdio: 'pipe',
  });

  execSync(`git worktree remove --force ${worktreePath}`, {
    cwd: repoRoot,
    stdio: 'pipe',
  });

  execSync(`git branch -d ${branchName}`, {
    cwd: repoRoot,
    stdio: 'pipe',
  });
}

/**
 * Remove the worktree and its branch without merging (used when a job is
 * abandoned or fails unrecoverably).
 *
 * @param {string} repoRoot
 * @param {string} jobId
 * @param {string} worktreePath
 */
export function abandonWorktree(repoRoot, jobId, worktreePath) {
  const branchName = getJobBranchName(jobId);

  try {
    execSync(`git worktree remove --force ${worktreePath}`, {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch {
    // Worktree may already be gone.
  }

  try {
    execSync(`git branch -D ${branchName}`, {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch {
    // Branch may not exist.
  }
}

/**
 * Find the git repository root containing the given directory.
 * Throws if not inside a git repository.
 *
 * @param {string} cwd
 * @returns {string}
 */
export function findRepoRoot(cwd) {
  return execSync('git rev-parse --show-toplevel', { cwd, stdio: 'pipe' })
    .toString()
    .trim();
}

/**
 * Ensure `.worktrees/` is present in `.gitignore` at the repo root.
 * Appends the entry if it is missing.
 *
 * @param {string} repoRoot
 */
export function ensureWorktreesIgnored(repoRoot) {
  const gitignorePath = join(repoRoot, '.gitignore');
  const entry = '.worktrees/';

  let content = '';
  try {
    content = readFileSync(gitignorePath, 'utf-8');
  } catch {
    // File doesn't exist yet.
  }

  if (!content.split('\n').some((line) => line.trim() === entry)) {
    appendFileSync(gitignorePath, `\n${entry}\n`, 'utf-8');
  }
}
