export const ROUTING_PROVIDERS = ['openrouter', 'zai'];
export const DEFAULT_ORIGINAL_PROVIDERS = ['openai-codex', 'anthropic', 'google', 'xai'];

const PROVIDER_NOISE = new Set([
  'anthropic',
  'openai',
  'openai-codex',
  'google',
  'github',
  'copilot',
  'xai',
  'openrouter',
  'zai',
]);
const DECORATION_NOISE = new Set(['preview', 'experimental', 'latest', 'thinking', 'chat']);
const FAMILY_PROVIDER_MAP = new Map([
  ['claude', 'anthropic'],
  ['gpt', 'openai-codex'],
  ['gemini', 'google'],
  ['grok', 'xai'],
]);
const ALLOWED_BACKUP_PROVIDERS = new Set([...ROUTING_PROVIDERS, ...DEFAULT_ORIGINAL_PROVIDERS]);

export function normalizeModelName(name) {
  if (typeof name !== 'string') {
    return '';
  }

  return name
    .toLowerCase()
    .replace(/\bopenai codex\b/g, ' ')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b20\d{2}(?:[- ]?\d{2}(?:[- ]?\d{2})?)?\b/g, ' ')
    .replace(/(\d)\.(\d)/g, '$1dotmark$2')
    .replace(/[-_/]+/g, ' ')
    .replace(/\./g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((token) => !PROVIDER_NOISE.has(token))
    .filter((token) => !DECORATION_NOISE.has(token))
    .join(' ')
    .replace(/dotmark/g, '.')
    .trim();
}

function detectFamily(normalizedName) {
  for (const family of FAMILY_PROVIDER_MAP.keys()) {
    if (normalizedName.includes(family)) {
      return family;
    }
  }

  return undefined;
}

function tokenize(normalizedName) {
  return normalizedName.split(' ').filter(Boolean);
}

function scoreNameMatch(sourceName, candidateName) {
  if (!sourceName || !candidateName) {
    return 0;
  }

  if (sourceName === candidateName) {
    return 100;
  }

  if (sourceName.includes(candidateName) || candidateName.includes(sourceName)) {
    return 80;
  }

  const sourceTokens = tokenize(sourceName);
  const candidateTokens = tokenize(candidateName);
  const overlap = sourceTokens.filter((token) => candidateTokens.includes(token));
  if (overlap.length === 0) {
    return 0;
  }

  const maxTokenCount = Math.max(sourceTokens.length, candidateTokens.length);
  return Math.round((overlap.length / maxTokenCount) * 60);
}

function sortByName(models) {
  return [...models].sort((left, right) => {
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) {
      return byName;
    }

    return left.id.localeCompare(right.id);
  });
}

function uniqueInOrder(values) {
  const seen = new Set();
  const uniqueValues = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    uniqueValues.push(value);
  }

  return uniqueValues;
}

function isModelDescriptor(model) {
  return model && typeof model.provider === 'string' && typeof model.id === 'string' && typeof model.name === 'string';
}

function getActiveProviders(models) {
  return uniqueInOrder(
    sortByName((Array.isArray(models) ? models : []).filter(isModelDescriptor)).map((model) => model.provider),
  );
}

export function resolvePreferredProviders(models) {
  const availableProviders = new Set(getActiveProviders(models));
  const activeRouters = ROUTING_PROVIDERS.filter((provider) => availableProviders.has(provider));
  return [...activeRouters, ...DEFAULT_ORIGINAL_PROVIDERS];
}

function resolveProviderSearchOrder(family, preferredProviders) {
  if (!family) {
    return preferredProviders;
  }

  const familyProvider = FAMILY_PROVIDER_MAP.get(family);
  const routingProviders = preferredProviders.filter((provider) => ROUTING_PROVIDERS.includes(provider));
  const directFamilyProviders = familyProvider
    ? preferredProviders.filter((provider) => provider === familyProvider)
    : [];

  const focusedProviders = [...routingProviders, ...directFamilyProviders];
  if (focusedProviders.length > 0) {
    return uniqueInOrder(focusedProviders);
  }

  return preferredProviders;
}

function getBackupModelsByProvider(models, preferredProviders) {
  const backupModelsByProvider = new Map();

  for (const provider of uniqueInOrder(preferredProviders)) {
    if (!ALLOWED_BACKUP_PROVIDERS.has(provider)) {
      continue;
    }

    const providerModels = (Array.isArray(models) ? models : [])
      .filter((model) => isModelDescriptor(model) && model.provider === provider)
      .map((model) => ({
        provider: model.provider,
        id: model.id,
        name: model.name,
        normalizedName: normalizeModelName(model.name),
      }));
    backupModelsByProvider.set(provider, providerModels);
  }

  return backupModelsByProvider;
}

export function inspectGenerationPlan(models, preferredProviders = resolvePreferredProviders(models)) {
  const availableModels = Array.isArray(models) ? models : [];
  const normalizedPreferredProviders = uniqueInOrder(preferredProviders).filter((provider) =>
    ALLOWED_BACKUP_PROVIDERS.has(provider),
  );
  const activeProviders = getActiveProviders(availableModels);
  const copilotModels = sortByName(
    availableModels.filter((model) => isModelDescriptor(model) && model.provider === 'github-copilot'),
  );
  const backupModelsByProvider = getBackupModelsByProvider(availableModels, normalizedPreferredProviders);

  const matchedModels = [];
  const unmatchedCopilotModels = [];

  for (const copilotModel of copilotModels) {
    const normalizedName = normalizeModelName(copilotModel.name);
    if (!normalizedName) {
      unmatchedCopilotModels.push({ id: copilotModel.id, name: copilotModel.name });
      continue;
    }

    const family = detectFamily(normalizedName);
    const providerSearchOrder = resolveProviderSearchOrder(family, normalizedPreferredProviders);
    const strategy = [{ provider: 'github-copilot', model: copilotModel.id }];

    for (const provider of providerSearchOrder) {
      const candidates = backupModelsByProvider.get(provider) ?? [];
      let bestCandidate = undefined;
      let bestScore = 0;

      for (const candidate of candidates) {
        const score = scoreNameMatch(normalizedName, candidate.normalizedName);
        if (score > bestScore) {
          bestScore = score;
          bestCandidate = candidate;
        }
      }

      if (bestCandidate && bestScore >= 60) {
        strategy.push({ provider, model: bestCandidate.id });
      }
    }

    if (strategy.length < 2) {
      unmatchedCopilotModels.push({ id: copilotModel.id, name: copilotModel.name });
      continue;
    }

    matchedModels.push({
      id: copilotModel.id,
      name: copilotModel.name,
      strategy,
      sticky: true,
    });
  }

  return {
    activeProviders,
    preferredProviders: normalizedPreferredProviders,
    matchedModels,
    unmatchedCopilotModels,
  };
}

export function buildDefaultConfig(models, preferredProviders = resolvePreferredProviders(models)) {
  const plan = inspectGenerationPlan(models, preferredProviders);
  return { models: plan.matchedModels };
}

export function formatGenerationPlan(plan) {
  const activeProviders = Array.isArray(plan?.activeProviders) ? plan.activeProviders : [];
  const preferredProviders = Array.isArray(plan?.preferredProviders) ? plan.preferredProviders : [];
  const matchedModels = Array.isArray(plan?.matchedModels) ? plan.matchedModels : [];
  const unmatchedCopilotModels = Array.isArray(plan?.unmatchedCopilotModels) ? plan.unmatchedCopilotModels : [];

  const lines = [];

  lines.push(`Preferred provider order: ${preferredProviders.length > 0 ? preferredProviders.join(' -> ') : '(none)'}`);
  lines.push(`Active providers with available models: ${activeProviders.length > 0 ? activeProviders.join(', ') : '(none)'}`);
  lines.push('');
  lines.push('Matched GitHub Copilot models:');

  if (matchedModels.length === 0) {
    lines.push('- none');
  } else {
    for (const matchedModel of matchedModels) {
      lines.push(`- ${matchedModel.name} (${matchedModel.id})`);
      for (const route of matchedModel.strategy) {
        lines.push(`  - ${route.provider}/${route.model}`);
      }
    }
  }

  lines.push('');
  lines.push('Unmatched GitHub Copilot models:');

  if (unmatchedCopilotModels.length === 0) {
    lines.push('- none');
  } else {
    for (const unmatchedModel of unmatchedCopilotModels) {
      lines.push(`- ${unmatchedModel.name} (${unmatchedModel.id})`);
    }
  }

  return lines.join('\n');
}
