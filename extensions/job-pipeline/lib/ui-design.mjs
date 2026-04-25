const UI_KEYWORDS = [
  'ui',
  'ux',
  'screen',
  'page',
  'pages',
  'dashboard',
  'modal',
  'dialog',
  'wizard',
  'form',
  'table',
  'layout',
  'component',
  'components',
  'navigation',
  'template',
  'templates',
  'style',
  'styling',
  'theme',
  'card',
  'panel',
  'sidebar',
  'header',
  'footer',
  'tab',
  'tabs',
  'drawer',
  'popover',
  'tooltip',
  'checkout',
  'onboarding',
  'settings',
  'profile',
  'landing',
  'admin',
  'grid',
  'list view',
  'detail view',
];

const UI_FILE_PATTERN = /\.(html|css|scss|sass|less|tsx|jsx|vue|svelte)$/i;
const UI_PATH_SEGMENTS = ['templates', 'static', 'components', 'pages', 'ui', 'frontend'];

export function normalizePlannerUiAssessment(input) {
  const touchesUi = input?.touchesUi === true;
  const targetSurface = normalizeOptionalText(input?.targetSurface);
  const proposedDesign = normalizeOptionalText(input?.proposedDesign);

  return {
    touchesUi: touchesUi || Boolean(proposedDesign) || hasUiKeywords(targetSurface),
    targetSurface,
    proposedDesign,
  };
}

export function detectUiRequirement({ spec, plannerUiAssessment, scoutResult }) {
  const normalizedPlannerUiAssessment = normalizePlannerUiAssessment(plannerUiAssessment);
  const reasons = [];
  const coherenceFiles = extractUiRelevantFiles(scoutResult?.relevantFiles);

  if (normalizeOptionalText(spec?.proposedUiDesign)) {
    reasons.push('User supplied a proposed UI design.');
  }

  if (normalizedPlannerUiAssessment.touchesUi) {
    reasons.push('Planner flagged the work as touching UI.');
  }

  if (normalizedPlannerUiAssessment.proposedDesign) {
    reasons.push('Planner supplied a UI proposal for critique.');
  }

  const keywordSignalText = [
    spec?.goal,
    spec?.context,
    normalizedPlannerUiAssessment.targetSurface,
  ]
    .filter(Boolean)
    .join('\n');

  if (hasUiKeywords(keywordSignalText)) {
    reasons.push('Goal/context contains UI-related language.');
  }

  if (coherenceFiles.length > 0 && reasons.length > 0) {
    reasons.push('Scout found existing UI files relevant to the goal.');
  }

  return {
    required: reasons.length > 0,
    reasons,
    hasExistingUiSurface: coherenceFiles.length > 0 && reasons.length > 0,
    coherenceFiles,
    plannerUiAssessment: normalizedPlannerUiAssessment,
  };
}

export function selectVisualDesignMode({ spec, plannerUiAssessment, scoutResult }) {
  const detection = detectUiRequirement({ spec, plannerUiAssessment, scoutResult });
  const userProposal = normalizeOptionalText(spec?.proposedUiDesign);
  const normalizedPlannerUiAssessment = detection.plannerUiAssessment;

  if (!detection.required) {
    return {
      required: false,
      mode: null,
      proposalSource: 'none',
      proposedDesign: '',
      targetSurface: normalizedPlannerUiAssessment.targetSurface,
      coherenceFiles: detection.coherenceFiles,
      reasons: detection.reasons,
    };
  }

  if (userProposal) {
    return {
      required: true,
      mode: 'critique-proposal',
      proposalSource: 'user',
      proposedDesign: userProposal,
      targetSurface: normalizedPlannerUiAssessment.targetSurface,
      coherenceFiles: detection.coherenceFiles,
      reasons: detection.reasons,
    };
  }

  if (normalizedPlannerUiAssessment.proposedDesign) {
    return {
      required: true,
      mode: 'critique-proposal',
      proposalSource: 'planner',
      proposedDesign: normalizedPlannerUiAssessment.proposedDesign,
      targetSurface: normalizedPlannerUiAssessment.targetSurface,
      coherenceFiles: detection.coherenceFiles,
      reasons: detection.reasons,
    };
  }

  if (detection.hasExistingUiSurface) {
    return {
      required: true,
      mode: 'extend-existing-ui',
      proposalSource: 'none',
      proposedDesign: '',
      targetSurface: normalizedPlannerUiAssessment.targetSurface,
      coherenceFiles: detection.coherenceFiles,
      reasons: detection.reasons,
    };
  }

  return {
    required: true,
    mode: 'propose-new-ui',
    proposalSource: 'none',
    proposedDesign: '',
    targetSurface: normalizedPlannerUiAssessment.targetSurface,
    coherenceFiles: [],
    reasons: detection.reasons,
  };
}

export function formatUiDesignBrief(designResult) {
  if (!designResult || typeof designResult !== 'object') {
    return '';
  }

  const lines = [
    `Mode: ${designResult.mode ?? 'unknown'}`,
    `Summary: ${normalizeOptionalText(designResult.summary) || '(none provided)'}`,
  ];

  if (normalizeOptionalText(designResult.designOutput)) {
    lines.push('', 'Design Output:', designResult.designOutput.trim());
  }

  if (Array.isArray(designResult.acceptanceCriteria) && designResult.acceptanceCriteria.length > 0) {
    lines.push('', 'Acceptance Criteria:', ...designResult.acceptanceCriteria.map((item) => `- ${item}`));
  }

  if (Array.isArray(designResult.openQuestions) && designResult.openQuestions.length > 0) {
    lines.push('', 'Open Questions:', ...designResult.openQuestions.map((item) => `- ${item}`));
  }

  if (Array.isArray(designResult.coherenceBasis) && designResult.coherenceBasis.length > 0) {
    lines.push('', 'Coherence Basis:', ...designResult.coherenceBasis.map((item) => `- ${item}`));
  }

  return lines.join('\n').trim();
}

function extractUiRelevantFiles(relevantFiles) {
  if (!Array.isArray(relevantFiles)) {
    return [];
  }

  return relevantFiles
    .map((file) => String(file))
    .filter((file) => isUiRelevantFile(file))
    .slice(0, 8);
}

function isUiRelevantFile(filePath) {
  if (!filePath) {
    return false;
  }

  const normalized = String(filePath).toLowerCase();
  return UI_FILE_PATTERN.test(normalized)
    || UI_PATH_SEGMENTS.some((segment) => normalized.includes(`/${segment}/`) || normalized.startsWith(`${segment}/`));
}

function hasUiKeywords(text) {
  const normalized = String(text ?? '').toLowerCase();
  return UI_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function normalizeOptionalText(value) {
  const normalized = String(value ?? '').trim();
  return normalized.length > 0 ? normalized : '';
}
