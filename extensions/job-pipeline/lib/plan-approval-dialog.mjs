const DEFAULT_MIN_BODY_LINES = 8;
const DEFAULT_MAX_BODY_LINES = 12;

export function buildPlanApprovalDialogSpec({ planText, critiqueHighlights, uiDesignBrief }) {
  const normalizedPlan = normalizeBlock(planText, '(Planner returned an empty plan.)');
  const normalizedCritique = normalizeBlock(
    critiqueHighlights,
    'No issues were raised by the jester.',
  );
  const normalizedUiDesignBrief = normalizeBlock(
    uiDesignBrief,
    'No UI design work was required for this plan.',
  );

  return buildDialogSpec({
    title: 'Plan Approval',
    intro: 'Review the final plan, jester critique, and any UI design brief before continuing.',
    sections: [
      ['Final Plan', normalizedPlan],
      ['Jester Critique Highlights', normalizedCritique],
      ['UI Design Brief', normalizedUiDesignBrief],
    ],
    question: 'Approve this plan and continue to task writing?',
    approveLabel: 'Continue',
    denyLabel: 'Pause',
  });
}

export function buildProofReviewDialogSpec({ verdict, notes, proofDeckPath }) {
  return buildDialogSpec({
    title: 'Proof Review',
    intro: 'Review the reviewer output before deciding whether to merge.',
    sections: [
      ['Verdict', normalizeBlock(verdict, '(No review verdict recorded.)')],
      ['Reviewer Notes', normalizeBlock(notes, '(The reviewer returned no notes.)')],
      ['Proof Deck', normalizeBlock(proofDeckPath, '(No proof deck path recorded.)')],
    ],
    question: 'Merge this reviewed worktree into the main branch?',
    approveLabel: 'Merge',
    denyLabel: 'Request changes',
  });
}

export function buildRetroReviewDialogSpec({
  summary,
  processChanges,
  cleanRetroStreak,
  cleanRetrosRequired,
}) {
  const normalizedChanges = Array.isArray(processChanges) && processChanges.length > 0
    ? processChanges.map((change) => `- ${change}`).join('\n')
    : 'No process changes proposed.';

  return buildDialogSpec({
    title: 'Retrospective',
    intro: 'Review the retro summary before finishing the job.',
    sections: [
      ['Summary', normalizeBlock(summary, '(The retro returned no summary.)')],
      ['Process Changes', normalizedChanges],
      ['Streak', `${cleanRetroStreak} / ${cleanRetrosRequired} clean retros`],
    ],
    question: 'Acknowledge this retrospective and finish the job?',
    approveLabel: 'Acknowledge',
    denyLabel: 'Pause',
  });
}

export class ScrollableApprovalDialogState {
  constructor({
    bodyText,
    question,
    minBodyLines = DEFAULT_MIN_BODY_LINES,
    maxBodyLines = DEFAULT_MAX_BODY_LINES,
    initialChoice = 'approve',
  }) {
    this.bodyText = String(bodyText ?? '');
    this.question = String(question ?? '');
    this.minBodyLines = Math.max(1, minBodyLines);
    this.maxBodyLines = Math.max(this.minBodyLines, maxBodyLines);
    this.selectedChoice = initialChoice === 'deny' ? 'deny' : 'approve';
    this.scrollOffset = 0;
    this.cachedWidth = undefined;
    this.cachedLayout = undefined;
  }

  invalidate() {
    this.cachedWidth = undefined;
    this.cachedLayout = undefined;
  }

  getViewport(width) {
    const layout = this.#getLayout(width);
    return {
      lines: layout.bodyLines.slice(this.scrollOffset, this.scrollOffset + layout.visibleLineCount),
      scrollOffset: this.scrollOffset,
      maxScrollOffset: layout.maxScrollOffset,
      visibleLineCount: layout.visibleLineCount,
      totalLineCount: layout.bodyLines.length,
    };
  }

  getVisibleBodyLines(width) {
    return this.getViewport(width).lines;
  }

  getVisibleBodyLineCount(width) {
    return this.#getLayout(width).visibleLineCount;
  }

  getTotalBodyLineCount(width) {
    return this.#getLayout(width).bodyLines.length;
  }

  getMaxScrollOffset(width) {
    return this.#getLayout(width).maxScrollOffset;
  }

  getSelectedChoice() {
    return this.selectedChoice;
  }

  selectApprove() {
    this.selectedChoice = 'approve';
  }

  selectDeny() {
    this.selectedChoice = 'deny';
  }

  toggleChoice() {
    this.selectedChoice = this.selectedChoice === 'approve' ? 'deny' : 'approve';
  }

  confirm() {
    return this.selectedChoice === 'approve';
  }

  scrollUp(width, delta = 1) {
    this.#getLayout(width);
    this.scrollOffset = clamp(this.scrollOffset - Math.max(1, delta), 0, this.cachedLayout.maxScrollOffset);
  }

  scrollDown(width, delta = 1) {
    this.#getLayout(width);
    this.scrollOffset = clamp(this.scrollOffset + Math.max(1, delta), 0, this.cachedLayout.maxScrollOffset);
  }

  pageUp(width) {
    const delta = Math.max(1, this.getVisibleBodyLineCount(width) - 1);
    this.scrollUp(width, delta);
  }

  pageDown(width) {
    const delta = Math.max(1, this.getVisibleBodyLineCount(width) - 1);
    this.scrollDown(width, delta);
  }

  #getLayout(width) {
    const normalizedWidth = Math.max(1, Math.floor(width || 1));
    if (this.cachedLayout && this.cachedWidth === normalizedWidth) {
      return this.cachedLayout;
    }

    const bodyLines = wrapPlainText(this.bodyText, normalizedWidth);
    const visibleLineCount = Math.min(
      this.maxBodyLines,
      Math.max(this.minBodyLines, bodyLines.length || 1),
    );
    const maxScrollOffset = Math.max(0, bodyLines.length - visibleLineCount);
    this.scrollOffset = clamp(this.scrollOffset, 0, maxScrollOffset);

    this.cachedWidth = normalizedWidth;
    this.cachedLayout = {
      bodyLines,
      visibleLineCount,
      maxScrollOffset,
    };
    return this.cachedLayout;
  }
}

export function wrapPlainText(text, width) {
  const normalizedWidth = Math.max(1, Math.floor(width || 1));
  const sourceLines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
  const wrappedLines = [];

  for (const sourceLine of sourceLines) {
    if (sourceLine.length === 0) {
      wrappedLines.push('');
      continue;
    }

    const indentMatch = sourceLine.match(/^\s*/);
    const indent = indentMatch?.[0] ?? '';
    const content = sourceLine.slice(indent.length);

    if (content.length === 0) {
      wrappedLines.push(indent.slice(0, normalizedWidth));
      continue;
    }

    const maxContentWidth = Math.max(1, normalizedWidth - indent.length);
    const tokens = content.match(/\S+|\s+/g) ?? [content];
    let currentLine = indent;
    let emittedLine = false;

    for (const token of tokens) {
      if (/^\s+$/.test(token)) {
        if (currentLine.trim().length > 0) {
          currentLine += ' ';
        }
        continue;
      }

      if (token.length > maxContentWidth) {
        if (currentLine.trim().length > 0) {
          wrappedLines.push(currentLine.trimEnd());
          emittedLine = true;
          currentLine = indent;
        }
        for (const chunk of chunkText(token, maxContentWidth)) {
          wrappedLines.push(indent + chunk);
          emittedLine = true;
        }
        continue;
      }

      const candidate = currentLine.trim().length === 0
        ? indent + token
        : `${currentLine.trimEnd()} ${token}`;

      if (candidate.length <= normalizedWidth) {
        currentLine = candidate;
        continue;
      }

      wrappedLines.push(currentLine.trimEnd());
      emittedLine = true;
      currentLine = indent + token;
    }

    if (currentLine.trim().length > 0 || !emittedLine) {
      wrappedLines.push(currentLine.trimEnd());
    }
  }

  return wrappedLines.length > 0 ? wrappedLines : [''];
}

function buildDialogSpec({ title, intro, sections, question, approveLabel, denyLabel }) {
  return {
    title,
    body: [
      intro,
      '',
      ...sections.flatMap(([heading, content], index) => [
        heading,
        '',
        content,
        ...(index === sections.length - 1 ? [] : ['', '']),
      ]),
    ].join('\n'),
    question,
    approveLabel,
    denyLabel,
  };
}

function chunkText(text, width) {
  const chunks = [];
  for (let index = 0; index < text.length; index += width) {
    chunks.push(text.slice(index, index + width));
  }
  return chunks;
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(max, Math.max(min, value));
}

function normalizeBlock(text, fallback) {
  const value = String(text ?? '').trim();
  return value.length > 0 ? value : fallback;
}
