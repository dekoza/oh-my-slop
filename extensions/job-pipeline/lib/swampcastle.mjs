/**
 * Builds structured messages for persisting pipeline events to SwampCastle.
 *
 * These functions return plain-text prompts that the main session LLM is
 * asked to execute (via pi.sendUserMessage). They describe MCP tool calls
 * in natural language so the model handles the SwampCastle API surface,
 * which can change, rather than hardcoding tool invocations in TypeScript.
 */

/**
 * @param {{ jobId: string, summary: string, processChanges: object[] }} options
 * @returns {string}
 */
export function buildRetroWritePrompt({ jobId, summary, processChanges }) {
  const lines = [
    '[job-pipeline] Write retrospective to SwampCastle.',
    `Wing: oh_my_slop  Room: general`,
    '',
    `Job ID: ${jobId}`,
    '',
    '## Summary',
    summary,
  ];

  if (processChanges.length > 0) {
    lines.push('', '## Process changes proposed');
    for (const change of processChanges) {
      lines.push(`- ${change.description}: ${change.rationale}`);
    }
  }

  lines.push(
    '',
    'Call swampcastle_add_drawer with:',
    `  wing: "oh_my_slop"`,
    `  room: "general"`,
    `  content: the full retro text above`,
    '',
    'After writing, confirm with a brief acknowledgement.',
  );

  return lines.join('\n');
}

/**
 * @param {{ jobId: string, stage: string, issues: object[] }} options
 * @returns {string}
 */
export function buildJesterFlagsWritePrompt({ jobId, stage, issues }) {
  const lines = [
    '[job-pipeline] Record repeated jester flags to SwampCastle.',
    `Wing: oh_my_slop  Room: general`,
    '',
    `Job ID: ${jobId}  Stage: ${stage}`,
    '',
    '## Issues flagged by jester',
    ...issues.map((issue) => `- [${issue.severity}] ${issue.critique}`),
    '',
    'For each issue, call swampcastle_kg_add with:',
    `  subject: "job-pipeline/${jobId}"`,
    `  predicate: "jester_flag"`,
    `  object: "<severity>: <summary of critique>"`,
    '',
    'After writing all entries, confirm.',
  ];

  return lines.join('\n');
}

/**
 * @param {{ jobId: string, description: string, rationale: string }} options
 * @returns {string}
 */
export function buildProcessChangeWritePrompt({ jobId, description, rationale }) {
  return [
    '[job-pipeline] Record a process change decision to SwampCastle.',
    `Wing: oh_my_slop  Room: general`,
    '',
    `Job ID: ${jobId}`,
    `Change: ${description}`,
    `Rationale: ${rationale}`,
    '',
    'Call swampcastle_add_drawer with this content.',
    'Then call swampcastle_kg_add with:',
    `  subject: "job-pipeline/process"`,
    `  predicate: "change_applied"`,
    `  object: "${description}"`,
    '',
    'Confirm after writing.',
  ].join('\n');
}
