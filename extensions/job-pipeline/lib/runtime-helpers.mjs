export function createInitialJobState({ id, description, cwd, now = Date.now() }) {
  return {
    id,
    description,
    cwd,
    step: 'interview',
    createdAt: now,
    updatedAt: now,
    replanCount: 0,
    cycleIndex: 1,
    jesterFlags: [],
    tokenCosts: {},
  };
}

export function buildInterviewCapturedMessage() {
  return 'Interview spec captured successfully. Ready to run pipeline.';
}

export function formatPipelineError(error) {
  if (error instanceof Error) {
    return {
      text: `Pipeline error: ${error.message}`,
      details: {
        errorName: error.name,
        stack: error.stack,
      },
    };
  }
  return {
    text: `Pipeline error: ${String(error)}`,
    details: {
      errorName: 'UnknownError',
      stack: undefined,
    },
  };
}

export function buildSubagentLoaderOptions({ cwd, agentDir, systemPrompt, additionalContextFiles = [] }) {
  return {
    cwd,
    agentDir,
    agentsFilesOverride: (current) => ({
      agentsFiles: [
        ...(current.agentsFiles ?? []),
        { path: '/virtual/ROLE.md', content: systemPrompt },
        ...additionalContextFiles,
      ],
    }),
  };
}
