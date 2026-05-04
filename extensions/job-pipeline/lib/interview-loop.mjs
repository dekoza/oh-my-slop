import { extractJson } from './agents.mjs';

const VALID_EVIDENCE_HINTS = new Set(['screenshots', 'logs', 'both']);

export function appendInterviewTranscriptEntry(transcript, role, content) {
  const normalizedRole = role === 'assistant' ? 'assistant' : 'user';
  const normalizedContent = String(content ?? '').trim();
  if (!normalizedContent) {
    return [...normalizeInterviewTranscript(transcript)];
  }

  return [
    ...normalizeInterviewTranscript(transcript),
    { role: normalizedRole, content: normalizedContent },
  ];
}

export function buildInterviewTranscriptText(transcript) {
  const normalized = normalizeInterviewTranscript(transcript);
  if (normalized.length === 0) {
    return '(no interview transcript yet)';
  }

  return normalized
    .map((entry) => `${entry.role === 'assistant' ? 'Planner' : 'User'}: ${entry.content}`)
    .join('\n\n');
}

export function parseInterviewPlannerResponse(text) {
  const parsed = extractJson(String(text ?? ''));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Interview planner response must be a JSON object.');
  }

  const status = parsed.status;
  if (status !== 'ask' && status !== 'complete') {
    throw new Error('Interview planner response must include status "ask" or "complete".');
  }

  const message = String(parsed.message ?? '').trim();
  if (!message) {
    throw new Error('Interview planner response must include a non-empty message.');
  }

  if (status === 'ask') {
    return { status, message };
  }

  return {
    status,
    message,
    spec: validateInterviewSpec(parsed.spec),
  };
}

function validateInterviewSpec(spec) {
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('Interview planner completion must include a spec object.');
  }

  const goal = String(spec.goal ?? '').trim();
  const context = String(spec.context ?? '').trim();
  const constraints = normalizeStringArray(spec.constraints, 'constraints');
  const outOfScope = normalizeStringArray(spec.outOfScope, 'outOfScope');
  const questionsToScout = normalizeStringArray(spec.questionsToScout, 'questionsToScout');
  const evidenceHint = String(spec.evidenceHint ?? '').trim();
  const proposedUiDesign = String(spec.proposedUiDesign ?? '').trim();

  if (!goal) {
    throw new Error('Interview spec must include a non-empty goal.');
  }
  if (!context) {
    throw new Error('Interview spec must include a non-empty context.');
  }
  if (!VALID_EVIDENCE_HINTS.has(evidenceHint)) {
    throw new Error('Interview spec must include a valid evidenceHint.');
  }

  return {
    goal,
    context,
    constraints,
    outOfScope,
    questionsToScout,
    evidenceHint,
    ...(proposedUiDesign ? { proposedUiDesign } : {}),
  };
}

function normalizeInterviewTranscript(transcript) {
  if (!Array.isArray(transcript)) {
    return [];
  }

  return transcript
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      role: entry.role === 'assistant' ? 'assistant' : 'user',
      content: String(entry.content ?? '').trim(),
    }))
    .filter((entry) => entry.content.length > 0);
}

function normalizeStringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`Interview spec field ${fieldName} must be an array of strings.`);
  }
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
