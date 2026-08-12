/**
 * HTML proof deck generator.
 *
 * Produces a self-contained HTML file embedding all evidence artifacts
 * (logs, screenshots) inline. Screenshots are embedded as base64 data URIs.
 * Log output is embedded in <pre> blocks. If a previous deck path is
 * provided, a comparison link is included at the top.
 *
 * This module has no Node.js I/O dependencies — callers are responsible
 * for reading artifact bytes before calling generateProofHtml and for
 * writing the output string to disk.
 */

/**
 * @typedef {{ type: 'log', content: string, description: string }} LogArtifact
 * @typedef {{ type: 'screenshot', content: string, mimeType: string, description: string }} ScreenshotArtifact
 * @typedef {LogArtifact | ScreenshotArtifact} ProofArtifact
 *
 * @typedef {{
 *   taskId: string,
 *   success: boolean,
 *   failureReport?: { attempted: string, found: string, reason: string },
 *   proofArtifacts: ProofArtifact[],
 * }} WorkerResult
 *
 * @typedef {{
 *   severity?: string,
 *   taskId?: string,
 *   title?: string,
 *   evidence?: string,
 *   impact?: string,
 *   fix?: string,
 * }} ReviewFinding
 *
 * @typedef {{
 *   jobId: string,
 *   goal: string,
 *   timestamp: number,
 *   cycleIndex: number,
 *   workerResults: WorkerResult[],
 *   reviewNotes?: string,
 *   reviewFindings?: ReviewFinding[],
 *   reviewMissingTests?: string[],
 *   reviewOpenQuestions?: string[],
 *   reviewEvidenceSummary?: string,
 *   jesterCritique?: string,
 *   plannerResolution?: string,
 *   previousDeckPath?: string,
 * }} ProofDeck
 */

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(ts) {
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

function renderArtifact(artifact) {
  if (artifact.type === 'screenshot') {
    return `
      <figure class="artifact artifact-screenshot">
        <img src="data:${escHtml(artifact.mimeType)};base64,${escHtml(artifact.content)}"
             alt="${escHtml(artifact.description)}" loading="lazy" />
        <figcaption>${escHtml(artifact.description)}</figcaption>
      </figure>`;
  }

  // log
  return `
    <div class="artifact artifact-log">
      <p class="artifact-label">${escHtml(artifact.description)}</p>
      <pre><code>${escHtml(artifact.content)}</code></pre>
    </div>`;
}

function renderWorkerResult(result) {
  const statusClass = result.success ? 'status-ok' : 'status-fail';
  const statusLabel = result.success ? '✓ passed' : '✗ failed';

  let failureBlock = '';
  if (!result.success && result.failureReport) {
    const r = result.failureReport;
    failureBlock = `
      <div class="failure-report">
        <p><strong>Attempted:</strong> ${escHtml(r.attempted)}</p>
        <p><strong>Found:</strong> ${escHtml(r.found)}</p>
        <p><strong>Reason:</strong> ${escHtml(r.reason)}</p>
      </div>`;
  }

  const artifactsBlock = result.proofArtifacts.map(renderArtifact).join('\n');

  return `
    <section class="task-result">
      <h3 class="${statusClass}">Task: ${escHtml(result.taskId)} <span class="badge">${statusLabel}</span></h3>
      ${failureBlock}
      ${artifactsBlock || '<p class="no-artifacts">No artifacts recorded.</p>'}
    </section>`;
}

function renderOptionalSection(title, content) {
  if (!content) return '';
  return `
    <section class="meta-section">
      <h2>${escHtml(title)}</h2>
      <div class="prose">${escHtml(content)}</div>
    </section>`;
}

function renderStringListSection(title, items) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `
    <section class="meta-section">
      <h2>${escHtml(title)}</h2>
      <ul class="meta-list">
        ${items.map((item) => `<li>${escHtml(item)}</li>`).join('\n')}
      </ul>
    </section>`;
}

function renderReviewFindings(findings) {
  if (!Array.isArray(findings) || findings.length === 0) return '';

  return `
    <section class="meta-section">
      <h2>Review Findings</h2>
      <div class="findings">
        ${findings
          .map((finding) => {
            const severity = finding.severity ? escHtml(String(finding.severity)) : 'unspecified';
            const taskId = finding.taskId ? ` <span class="finding-task">(${escHtml(String(finding.taskId))})</span>` : '';
            return `
              <article class="finding-card severity-${severity.toLowerCase()}">
                <h3><span class="finding-badge">${severity}</span> ${escHtml(finding.title ?? 'Untitled finding')}${taskId}</h3>
                ${finding.evidence ? `<p><strong>Evidence:</strong> ${escHtml(finding.evidence)}</p>` : ''}
                ${finding.impact ? `<p><strong>Impact:</strong> ${escHtml(finding.impact)}</p>` : ''}
                ${finding.fix ? `<p><strong>Recommended fix:</strong> ${escHtml(finding.fix)}</p>` : ''}
              </article>`;
          })
          .join('\n')}
      </div>
    </section>`;
}

/**
 * Generate a self-contained HTML proof deck string.
 *
 * @param {ProofDeck} deck
 * @returns {string}
 */
export function generateProofHtml(deck) {
  const previousLink = deck.previousDeckPath
    ? `<p class="previous-link">↩ <a href="${escHtml(deck.previousDeckPath)}">Compare with previous proof (cycle ${deck.cycleIndex - 1})</a></p>`
    : '';

  const taskSections = deck.workerResults.map(renderWorkerResult).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Proof Deck — ${escHtml(deck.jobId)} — Cycle ${deck.cycleIndex}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; color: #222; }
    h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
    h2 { font-size: 1.2rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; margin-top: 2rem; }
    h3 { font-size: 1rem; margin-bottom: 0.5rem; }
    .meta { color: #666; font-size: 0.875rem; margin-bottom: 2rem; }
    .previous-link { background: #f5f5f5; padding: 0.5rem 1rem; border-radius: 4px; }
    .task-result { border: 1px solid #e0e0e0; border-radius: 6px; padding: 1rem; margin-bottom: 1rem; }
    .status-ok { color: #1a7a1a; }
    .status-fail { color: #c0392b; }
    .badge { font-size: 0.75rem; font-weight: normal; background: #f0f0f0; padding: 0.1em 0.4em; border-radius: 3px; }
    .failure-report { background: #fff0f0; border-left: 3px solid #c0392b; padding: 0.75rem; margin: 0.5rem 0; border-radius: 0 4px 4px 0; }
    .artifact { margin-top: 1rem; }
    .artifact-label { font-weight: 600; margin-bottom: 0.25rem; font-size: 0.875rem; }
    pre { background: #f8f8f8; border: 1px solid #e0e0e0; border-radius: 4px; padding: 0.75rem; overflow-x: auto; font-size: 0.8rem; }
    img { max-width: 100%; border: 1px solid #ddd; border-radius: 4px; }
    figcaption { font-size: 0.8rem; color: #666; margin-top: 0.25rem; }
    .no-artifacts { color: #999; font-style: italic; }
    .prose { white-space: pre-wrap; background: #fafafa; border: 1px solid #e8e8e8; border-radius: 4px; padding: 0.75rem; }
    .meta-section { margin-top: 2rem; }
    .meta-list { margin: 0; padding-left: 1.25rem; }
    .meta-list li { margin: 0.35rem 0; }
    .findings { display: grid; gap: 0.75rem; }
    .finding-card { border: 1px solid #e2e2e2; border-left-width: 4px; border-radius: 6px; padding: 0.85rem 1rem; background: #fcfcfc; }
    .finding-card h3 { display: flex; gap: 0.5rem; align-items: baseline; flex-wrap: wrap; }
    .finding-badge { display: inline-block; text-transform: uppercase; font-size: 0.72rem; letter-spacing: 0.04em; background: #efefef; border-radius: 999px; padding: 0.15rem 0.5rem; }
    .finding-task { color: #666; font-size: 0.9rem; }
    .severity-critical { border-left-color: #b42318; }
    .severity-major { border-left-color: #b54708; }
    .severity-minor { border-left-color: #1d4ed8; }
  </style>
</head>
<body>
  <h1>Proof Deck — ${escHtml(deck.jobId)}</h1>
  <div class="meta">
    <strong>Goal:</strong> ${escHtml(deck.goal)}<br/>
    <strong>Cycle:</strong> ${deck.cycleIndex}<br/>
    <strong>Generated:</strong> ${formatDate(deck.timestamp)}
  </div>
  ${previousLink}
  <h2>Worker Results</h2>
  ${taskSections || '<p>No worker results recorded.</p>'}
  ${renderOptionalSection('Review Notes', deck.reviewNotes)}
  ${renderReviewFindings(deck.reviewFindings)}
  ${renderStringListSection('Missing Tests', deck.reviewMissingTests)}
  ${renderStringListSection('Open Questions', deck.reviewOpenQuestions)}
  ${renderOptionalSection('Evidence Inspected', deck.reviewEvidenceSummary)}
  ${renderOptionalSection('Jester Critique', deck.jesterCritique)}
  ${renderOptionalSection('Planner Resolution', deck.plannerResolution)}
</body>
</html>`;
}
