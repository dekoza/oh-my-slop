export function parseJobWorkersArgs(rawArgs) {
  const tokens = String(rawArgs ?? '').trim().length > 0
    ? String(rawArgs).trim().split(/\s+/)
    : [];

  let jobId;
  let cycleFilter = 'all';

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--cycle') {
      const value = tokens[index + 1];
      if (!value) {
        return { cycleFilter, error: 'Missing value for --cycle.' };
      }
      if (value === 'all') {
        cycleFilter = 'all';
        index += 1;
        continue;
      }

      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed < 1) {
        return { cycleFilter, error: `Invalid --cycle value: ${value}` };
      }
      cycleFilter = parsed;
      index += 1;
      continue;
    }

    if (token.startsWith('--')) {
      return { cycleFilter, error: `Unknown /job-workers argument: ${token}` };
    }

    if (jobId) {
      return { jobId, cycleFilter, error: `Unexpected extra argument: ${token}` };
    }
    jobId = token;
  }

  return jobId ? { jobId, cycleFilter } : { cycleFilter };
}

export function buildBrowserOpenCommand(targetPath, { platform = process.platform } = {}) {
  const normalizedPath = String(targetPath ?? '').trim();
  if (!normalizedPath) {
    return null;
  }

  if (platform === 'darwin') {
    return { command: 'open', args: [normalizedPath] };
  }
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/c', 'start', '', normalizedPath] };
  }
  return { command: 'xdg-open', args: [normalizedPath] };
}

export function normalizeCycleFilter(cycleFilter) {
  if (cycleFilter === 'all') {
    return 'all';
  }
  const parsed = Number(cycleFilter);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 'all';
}
