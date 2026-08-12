import { execFileSync } from 'node:child_process';

/**
 * Build a reviewer-facing summary that combines task requirements, worker
 * results, and proof artifact hints. The reviewer still has read-only tools,
 * but this summary gives it an explicit checklist and starting point.
 *
 * @param {{ tasks?: Array<{ id: string, title?: string, description?: string, testRequirement?: string, uiAcceptanceCriteria?: string[] }> } | null | undefined} taskGraph
 * @param {Array<{ taskId: string, success: boolean, summary?: string, artifactFiles?: string[], failureReport?: { attempted?: string, found?: string, reason?: string } }> | null | undefined} workerResults
 * @returns {string}
 */
export function buildReviewTaskContext(taskGraph, workerResults) {
  const tasks = Array.isArray(taskGraph?.tasks) ? taskGraph.tasks : [];
  const results = Array.isArray(workerResults) ? workerResults : [];

  if (results.length === 0) {
    return 'No worker results available.';
  }

  const tasksById = new Map(tasks.map((task) => [task.id, task]));

  return results
    .map((result) => {
      const task = tasksById.get(result.taskId) ?? {};
      const lines = [
        `Task ${result.taskId}${task.title ? ` — ${task.title}` : ''}`,
        `Requirement: ${task.description ?? '(not provided)'}`,
        `Test requirement: ${task.testRequirement ?? '(not provided)'}`,
        `UI acceptance criteria: ${Array.isArray(task.uiAcceptanceCriteria) && task.uiAcceptanceCriteria.length > 0 ? task.uiAcceptanceCriteria.join(' | ') : 'none specified'}`,
        `Worker status: ${result.success ? 'success' : 'failed'}`,
        `Worker summary: ${result.summary || '(none provided)'}`,
        `Reported artifacts: ${Array.isArray(result.artifactFiles) && result.artifactFiles.length > 0 ? result.artifactFiles.join(', ') : 'none reported'}`,
      ];

      if (!result.success && result.failureReport) {
        lines.push(`Failure attempted: ${result.failureReport.attempted ?? '(not provided)'}`);
        lines.push(`Failure found: ${result.failureReport.found ?? '(not provided)'}`);
        lines.push(`Failure reason: ${result.failureReport.reason ?? '(not provided)'}`);
      }

      return lines.join('\n');
    })
    .join('\n\n');
}

export function resolveReviewCwd(worktreePath, defaultCwd) {
  return worktreePath || defaultCwd;
}

export function buildReviewRepoContext({ repoRoot, worktreePath }) {
  const reviewCwd = resolveReviewCwd(worktreePath, repoRoot);
  if (!reviewCwd) {
    return 'Repository scope snapshot unavailable: no review working directory provided.';
  }

  try {
    const repositoryHead = runGit(repoRoot || reviewCwd, ['rev-parse', 'HEAD']);
    const branchName = runGit(reviewCwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
    const mergeBase = runGit(reviewCwd, ['merge-base', 'HEAD', repositoryHead]);
    const committedFiles = runGit(reviewCwd, ['diff', '--name-only', `${mergeBase}..HEAD`]);
    const committedStat = runGit(reviewCwd, ['diff', '--stat', `${mergeBase}..HEAD`]);
    const workingStatus = runGit(reviewCwd, ['status', '--short']);
    const uncommittedStat = runGit(reviewCwd, ['diff', '--stat']);
    const stagedStat = runGit(reviewCwd, ['diff', '--cached', '--stat']);

    return [
      `Review working directory: ${reviewCwd}`,
      `Review branch: ${branchName}`,
      `Branch point commit: ${mergeBase}`,
      'Changed files in committed branch history:',
      formatSection(committedFiles),
      '',
      'Committed diff stat:',
      formatSection(committedStat),
      '',
      'Working tree status:',
      formatSection(workingStatus),
      '',
      'Uncommitted tracked-file diff stat:',
      formatSection(uncommittedStat),
      '',
      'Staged diff stat:',
      formatSection(stagedStat),
    ].join('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return `Repository scope snapshot unavailable: ${message}`;
  }
}

function formatSection(text) {
  const normalized = text.trim();
  return normalized.length > 0 ? normalized : '(none)';
}

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}
