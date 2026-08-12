/**
 * Default configuration for the job-pipeline extension.
 * All pools default to empty so the user must explicitly configure them
 * via /job-pool before running a job.
 */
export const DEFAULT_JOB_PIPELINE_CONFIG = {
  pools: {
    scout: { models: [] },
    planner: { models: [] },
    jester: { models: [] },
    'task-writer': { models: [] },
    worker: { models: [] },
    reviewer: { models: [] },
  },
  gates: {
    scoutQuestion: { mode: 'compulsory' },
    planApproval: { mode: 'compulsory' },
    proofReview: { mode: 'compulsory' },
    retroReview: { mode: 'compulsory' },
  },
  autonomy: { cleanRetrosRequired: 3 },
  costs: { track: true },
};

const VALID_GATE_MODES = new Set(['compulsory', 'auto-accept']);
const GATE_KEYS = ['scoutQuestion', 'planApproval', 'proofReview', 'retroReview'];
const ROLE_KEYS = ['scout', 'planner', 'jester', 'task-writer', 'worker', 'reviewer'];

/**
 * @param {unknown} raw
 * @returns {{ value: typeof DEFAULT_JOB_PIPELINE_CONFIG, warnings?: string[] }}
 */
export function normalizeJobPipelineConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { value: structuredClone(DEFAULT_JOB_PIPELINE_CONFIG) };
  }

  const warnings = [];
  const fallback = DEFAULT_JOB_PIPELINE_CONFIG;

  return {
    value: {
      pools: normalizePools(raw.pools, fallback.pools, warnings),
      gates: normalizeGates(raw.gates, fallback.gates, warnings),
      autonomy: normalizeAutonomyConfig(raw.autonomy, fallback.autonomy),
      costs: normalizeCostsConfig(raw.costs, fallback.costs),
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

function normalizePools(raw, fallback, warnings) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return structuredClone(fallback);
  }

  const result = {};
  for (const role of ROLE_KEYS) {
    const pool = raw[role];
    if (!pool || typeof pool !== 'object') {
      result[role] = structuredClone(fallback[role]);
      continue;
    }

    const models = normalizeStringArray(pool.models);
    if (models.length === 0) {
      warnings.push(`Pool for role "${role}" has no valid models; using default.`);
      result[role] = structuredClone(fallback[role]);
    } else {
      result[role] = { models };
    }
  }
  return result;
}

function normalizeGates(raw, fallback, warnings) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return structuredClone(fallback);
  }

  const result = {};
  for (const key of GATE_KEYS) {
    const gate = raw[key];
    if (!gate || typeof gate !== 'object') {
      result[key] = { ...fallback[key] };
      continue;
    }

    if (typeof gate.mode === 'string' && VALID_GATE_MODES.has(gate.mode)) {
      result[key] = { mode: gate.mode };
    } else {
      warnings.push(`Gate "${key}" has invalid mode "${gate.mode}"; falling back to "compulsory".`);
      result[key] = { mode: 'compulsory' };
    }
  }
  return result;
}

function normalizeAutonomyConfig(raw, fallback) {
  if (!raw || typeof raw !== 'object') {
    return { ...fallback };
  }

  const required = Math.round(Number(raw.cleanRetrosRequired));
  return {
    cleanRetrosRequired:
      Number.isFinite(required) && required >= 1 ? required : fallback.cleanRetrosRequired,
  };
}

function normalizeCostsConfig(raw, fallback) {
  if (!raw || typeof raw !== 'object') {
    return { ...fallback };
  }
  return { track: typeof raw.track === 'boolean' ? raw.track : fallback.track };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}
