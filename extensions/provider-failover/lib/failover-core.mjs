export const FAILOVER_PROVIDER_NAME = 'failover';
export const FAILOVER_API = 'failover-router';

const RATE_LIMIT_PATTERNS = [
  /\b429\b/,
  /\b529\b/,
  /too many requests/i,
  /rate[_ -]?limit/i,
  /quota exceeded/i,
  /overloaded/i,
];

export function isRateLimitLike(message) {
  if (typeof message !== 'string' || message.trim() === '') {
    return false;
  }

  return RATE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}

export function orderCandidates(candidates, stickyKey) {
  if (!stickyKey) {
    return [...candidates];
  }

  const stickyIndex = candidates.findIndex((candidate) => candidate.key === stickyKey);
  if (stickyIndex <= 0) {
    return [...candidates];
  }

  return [
    candidates[stickyIndex],
    ...candidates.slice(0, stickyIndex),
    ...candidates.slice(stickyIndex + 1),
  ];
}

export function buildWrapperModel(wrapper, backendModels) {
  if (!Array.isArray(backendModels) || backendModels.length === 0) {
    throw new Error(`Failover model ${wrapper.id} has no backend models.`);
  }

  const first = backendModels[0];
  const commonInput = first.input.filter((inputType) =>
    backendModels.every((model) => model.input.includes(inputType)),
  );

  if (commonInput.length === 0) {
    throw new Error(`Failover model ${wrapper.id} has no common input types across backends.`);
  }

  return {
    id: wrapper.id,
    name: wrapper.name,
    api: FAILOVER_API,
    provider: FAILOVER_PROVIDER_NAME,
    reasoning: backendModels.every((model) => model.reasoning === true),
    input: commonInput,
    cost: { ...first.cost },
    contextWindow: Math.min(...backendModels.map((model) => model.contextWindow)),
    maxTokens: Math.min(...backendModels.map((model) => model.maxTokens)),
  };
}

export function formatAttemptSummary(attempts, skipped = []) {
  const failedAttempts = attempts.map((attempt) => {
    const target = `${attempt.provider}/${attempt.model}`;
    return `${target}: ${attempt.errorMessage}`;
  });

  const skippedAttempts = skipped.map((skip) => {
    const target = `${skip.provider}/${skip.model}`;
    return `${target}: ${skip.reason}`;
  });

  const lines = [...failedAttempts, ...skippedAttempts];
  if (lines.length === 0) {
    return 'No failover candidates were available.';
  }

  return ['Failover routing failed:', ...lines.map((line) => `- ${line}`)].join('\n');
}

export async function pipeFailoverStream({
  candidates,
  invoke,
  forward,
  isRetryable = isRateLimitLike,
  onFallback,
  onSuccess,
}) {
  const attempts = [];

  candidateLoop: for (const candidate of candidates) {
    const buffered = [];
    let committed = false;
    const sourceStream = await invoke(candidate);

    for await (const event of sourceStream) {
      if (!committed) {
        buffered.push(event);
      }

      if (event.type === 'start') {
        continue;
      }

      if (event.type === 'error') {
        const errorMessage = event.error?.errorMessage ?? 'Unknown provider error';
        const retryable = !committed && isRetryable(errorMessage);

        attempts.push({
          key: candidate.key,
          provider: candidate.provider,
          model: candidate.model,
          errorMessage,
          retryable,
        });

        if (retryable) {
          onFallback?.({ failedCandidate: candidate, errorMessage, attempts: [...attempts] });
          continue candidateLoop;
        }

        if (!committed) {
          for (const bufferedEvent of buffered) {
            await forward(bufferedEvent);
          }
        } else {
          await forward(event);
        }

        return {
          ok: false,
          attempts,
          usedCandidate: candidate,
          forwardedAny: committed || buffered.length > 0,
          finalErrorMessage: errorMessage,
        };
      }

      if (!committed) {
        committed = true;
        for (const bufferedEvent of buffered) {
          await forward(bufferedEvent);
        }
        buffered.length = 0;
      } else {
        await forward(event);
      }
    }

    if (!committed) {
      for (const bufferedEvent of buffered) {
        await forward(bufferedEvent);
      }
    }

    onSuccess?.({ candidate, attempts: [...attempts] });
    return {
      ok: true,
      attempts,
      usedCandidate: candidate,
      forwardedAny: committed || buffered.length > 0,
    };
  }

  return {
    ok: false,
    attempts,
    forwardedAny: false,
    finalErrorMessage: formatAttemptSummary(attempts),
  };
}
