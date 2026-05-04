import { readJobEvents } from './job-events.mjs';
import { rebuildSnapshotFromEvents } from './job-snapshot.mjs';
import { loadJobSnapshot, writeJobSnapshot } from './job-store.mjs';

const MAX_INLINE_IMAGE_COUNT = 3;

export function buildInterviewMessagePayload({ role, content, imageCount = 0, jobId, transcriptIndex }) {
  const normalizedRole = role === 'assistant' ? 'assistant' : 'user';
  const normalizedImageCount = Number.isFinite(imageCount) ? Math.max(0, Math.trunc(imageCount)) : 0;

  return {
    customType: normalizedRole === 'assistant'
      ? 'job-pipeline-interview'
      : 'job-pipeline-interview-user',
    content: String(content ?? '').trim(),
    display: true,
    details: {
      role: normalizedRole,
      imageCount: normalizedImageCount,
      ...(typeof jobId === 'string' && jobId.trim().length > 0 ? { jobId: jobId.trim() } : {}),
      ...(Number.isInteger(transcriptIndex) && transcriptIndex >= 0 ? { transcriptIndex } : {}),
    },
  };
}

export function buildInterviewMessageRenderModel(agentDir, message) {
  const details = message?.details && typeof message.details === 'object'
    ? message.details
    : {};
  const imageCount = Number.isFinite(details.imageCount)
    ? Math.max(0, Math.trunc(details.imageCount))
    : 0;
  const bodyText = String(message?.content ?? '').trim();
  const attachmentLabel = formatInterviewAttachmentLabel(imageCount);
  const inlineImages = resolveInlineImages(agentDir, details, imageCount);

  return {
    body: bodyText || attachmentLabel,
    attachmentLabel: bodyText && attachmentLabel ? attachmentLabel : '',
    inlineImages,
    remainingImageCount: inlineImages.length > 0 ? Math.max(0, imageCount - inlineImages.length) : 0,
  };
}

export function formatInterviewAttachmentLabel(imageCount) {
  const normalizedCount = Number.isFinite(imageCount) ? Math.max(0, Math.trunc(imageCount)) : 0;
  if (normalizedCount === 0) {
    return '';
  }
  return `[${normalizedCount} image${normalizedCount === 1 ? '' : 's'} attached]`;
}

function resolveInlineImages(agentDir, details, imageCount) {
  if (typeof details.jobId !== 'string' || !Number.isInteger(details.transcriptIndex) || details.transcriptIndex < 0) {
    return [];
  }

  const snapshot = loadRenderableSnapshot(agentDir, details.jobId);
  const transcript = Array.isArray(snapshot?.interviewTranscript)
    ? snapshot.interviewTranscript
    : [];
  const entry = transcript[details.transcriptIndex];
  if (!entry || typeof entry !== 'object') {
    return [];
  }

  return normalizeRenderableImages(entry.images).slice(0, Math.min(imageCount || MAX_INLINE_IMAGE_COUNT, MAX_INLINE_IMAGE_COUNT));
}

function loadRenderableSnapshot(agentDir, jobId) {
  const storedSnapshot = loadJobSnapshot(agentDir, jobId);
  if (storedSnapshot) {
    return storedSnapshot;
  }

  const events = readJobEvents(agentDir, jobId);
  if (events.length === 0) {
    return null;
  }

  const rebuiltSnapshot = rebuildSnapshotFromEvents(events);
  if (!rebuiltSnapshot || typeof rebuiltSnapshot !== 'object' || rebuiltSnapshot.id !== jobId) {
    return null;
  }

  writeJobSnapshot(agentDir, jobId, rebuiltSnapshot);
  return rebuiltSnapshot;
}

function normalizeRenderableImages(images) {
  if (!Array.isArray(images)) {
    return [];
  }

  return images
    .filter((image) => image && typeof image === 'object' && image.type === 'image')
    .map((image) => image.source)
    .filter((source) => source && typeof source === 'object' && source.type === 'base64')
    .map((source) => ({
      mediaType: String(source.mediaType ?? '').trim(),
      data: String(source.data ?? '').trim(),
    }))
    .filter((image) => image.mediaType.length > 0 && image.data.length > 0);
}
