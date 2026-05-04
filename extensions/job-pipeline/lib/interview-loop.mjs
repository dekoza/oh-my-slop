import { extractJson } from './agents.mjs';

const VALID_EVIDENCE_HINTS = new Set(['screenshots', 'logs', 'both']);

export function appendInterviewTranscriptEntry(transcript, role, content, images = []) {
  const normalizedRole = role === 'assistant' ? 'assistant' : 'user';
  const normalizedContent = String(content ?? '').trim();
  const normalizedImages = normalizeTranscriptImages(images);
  if (!normalizedContent && normalizedImages.length === 0) {
    return [...normalizeInterviewTranscript(transcript)];
  }

  return [
    ...normalizeInterviewTranscript(transcript),
    {
      role: normalizedRole,
      content: normalizedContent,
      ...(normalizedImages.length > 0 ? { images: normalizedImages } : {}),
    },
  ];
}

export function buildInterviewTranscriptText(transcript) {
  const normalized = normalizeInterviewTranscript(transcript);
  if (normalized.length === 0) {
    return '(no interview transcript yet)';
  }

  return normalized
    .map((entry) => {
      const speaker = entry.role === 'assistant' ? 'Planner' : 'User';
      const imageLabel = formatImageAttachmentLabel(entry.images ?? []);
      if (!entry.content && imageLabel) {
        return `${speaker}: ${imageLabel}`;
      }
      if (!imageLabel) {
        return `${speaker}: ${entry.content}`;
      }
      return `${speaker}: ${entry.content}\n${imageLabel}`;
    })
    .join('\n\n');
}

export function collectInterviewTranscriptImages(transcript) {
  return normalizeInterviewTranscript(transcript)
    .flatMap((entry) => entry.images ?? []);
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
    .map((entry) => {
      const images = normalizeTranscriptImages(entry.images);
      return {
        role: entry.role === 'assistant' ? 'assistant' : 'user',
        content: String(entry.content ?? '').trim(),
        ...(images.length > 0 ? { images } : {}),
      };
    })
    .filter((entry) => entry.content.length > 0 || Array.isArray(entry.images));
}

function normalizeTranscriptImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .filter((image) => image && typeof image === 'object' && image.type === 'image' && image.source && typeof image.source === 'object');
}

function formatImageAttachmentLabel(images) {
  const count = Array.isArray(images) ? images.length : 0;
  if (count === 0) {
    return '';
  }
  return `[${count} image${count === 1 ? '' : 's'} attached]`;
}

function normalizeStringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`Interview spec field ${fieldName} must be an array of strings.`);
  }
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}
