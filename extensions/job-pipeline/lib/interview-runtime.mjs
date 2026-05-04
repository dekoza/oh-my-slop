import { appendInterviewTranscriptEntry } from './interview-loop.mjs';
import { recordInterviewTranscript } from './job-lifecycle.mjs';
import { buildInterviewMessagePayload } from './interview-render.mjs';

export function appendInterviewMessageAndPersist(agentDir, jobState, {
  role,
  content,
  images = [],
  now = Date.now(),
} = {}) {
  const transcript = Array.isArray(jobState?.interviewTranscript)
    ? [...jobState.interviewTranscript]
    : [];
  const nextTranscript = appendInterviewTranscriptEntry(transcript, role, content, images);

  if (nextTranscript.length === transcript.length) {
    throw new Error('Interview message must include non-empty content or at least one image.');
  }

  const nextState = recordInterviewTranscript(agentDir, jobState, nextTranscript, { now });
  const transcriptIndex = nextTranscript.length - 1;
  const entry = nextTranscript[transcriptIndex];

  return {
    jobState: nextState,
    transcript: nextTranscript,
    transcriptIndex,
    messagePayload: buildInterviewMessagePayload({
      role: entry.role,
      content: entry.content,
      imageCount: Array.isArray(entry.images) ? entry.images.length : 0,
      jobId: nextState.id,
      transcriptIndex,
    }),
  };
}
