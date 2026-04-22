import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { spawnAgent, spawnCodingAgent, extractJson } from './agents.mjs';
import { resolveExecutionBatches } from './tasks.mjs';
import { generateProofHtml } from './proof.mjs';
import { writeJobState, writeProofDeck, getArtifactDir } from './state.mjs';
import { createWorktree, mergeAndCleanWorktree, findRepoRoot, ensureWorktreesIgnored } from './worktree.mjs';
import {
  scoutPrompt,
  plannerInitialPrompt,
  plannerRevisePrompt,
  jesterPrompt,
  taskWriterPrompt,
  workerPrompt,
  reviewerPrompt,
} from './prompts.mjs';

/**
 * Run the full pipeline from scout through to retro.
 *
 * @param {{
 *   jobState: object,
 *   agentDir: string,
 *   config: object,
 *   ui: object,       ExtensionContext ui (from captured ctx)
 *   signal?: AbortSignal,
 *   onProgress: (message: string) => void,
 * }} options
 * @returns {Promise<object>}  Final job state
 */
export async function runPipeline({ jobState, agentDir, config, ui, signal, onProgress }) {
  const state = { ...jobState };
  const pool = state.pool;
  const cwd = state.cwd ?? process.cwd();
  const repoRoot = findRepoRoot(cwd);

  // ── Scout ──────────────────────────────────────────────────────────────────

  if (!state.scoutResult) {
    onProgress('scout: building question list');

    const defaultQuestions = [
      'What existing authentication patterns are used in this codebase?',
      'Which files are most relevant to the goal?',
      'What test frameworks and patterns are used?',
    ];
    const scoutQuestions = state.spec?.questionsToScout ?? defaultQuestions;
    const scoutQuestion = scoutQuestions[0] ?? 'Summarise the codebase as it relates to the goal.';

    // Scout question gate
    const gateMode = config.gates.scoutQuestion.mode;
    if (gateMode === 'compulsory') {
      const approved = await ui.confirm(
        'Scout Question Gate',
        `The planner wants to ask the scout:\n\n"${scoutQuestion}"\n\nApprove?`,
      );
      if (!approved) {
        throw new GateDeniedError('scout-question');
      }
    } else {
      ui.notify(`[auto-accept] Scout question: ${scoutQuestion}`, 'info');
    }

    onProgress('scout: running');
    const scoutOutput = await spawnAgent({
      modelId: pool.scout,
      systemPrompt: scoutPrompt({ goal: state.spec.goal, questions: scoutQuestions }),
      userPrompt: `Reconnaissance mission for: ${state.spec.goal}`,
      cwd,
      signal,
    });

    state.scoutResult = safeExtractJson(scoutOutput, { summary: scoutOutput, answers: [], relevantFiles: [] });
    state.step = 'planning';
    persist(agentDir, state);
    onProgress('scout: complete');
  }

  // ── Planning loop ──────────────────────────────────────────────────────────

  if (!state.finalPlan) {
    onProgress('planner: generating initial plan');
    const scoutSummary = formatScoutSummary(state.scoutResult);

    let planText = await callPlanner({
      modelId: pool.planner,
      goal: state.spec.goal,
      interviewNotes: state.spec.context ?? '',
      scoutSummary,
      signal,
    });

    for (let round = 1; round <= 2; round++) {
      onProgress(`jester: critique round ${round}`);
      const jesterOutput = await spawnAgent({
        modelId: pool.jester,
        systemPrompt: jesterPrompt({ stage: 'planning', content: planText }),
        userPrompt: 'Critique this plan.',
        cwd,
        signal,
      });

      const critique = safeExtractJson(jesterOutput, { verdict: 'acceptable', issues: [], summary: jesterOutput });

      if (critique.verdict === 'acceptable' && round === 1) {
        onProgress('jester: no issues in round 1, skipping round 2');
        state.planCritiques = [jesterOutput];
        break;
      }

      state.planCritiques = [...(state.planCritiques ?? []), jesterOutput];

      if (round < 2) {
        onProgress(`planner: revising plan (round ${round})`);
        planText = await callPlannerRevise({
          modelId: pool.planner,
          previousPlan: planText,
          jesterCritique: jesterOutput,
          round,
          cwd,
          signal,
        });
      }
    }

    // Plan approval gate
    const gateMode = config.gates.planApproval.mode;
    const critiqueHighlights = formatCritiqueHighlights(state.planCritiques ?? []);
    if (gateMode === 'compulsory') {
      const planDisplay = `${planText}\n\n--- Jester highlights ---\n${critiqueHighlights}`;
      const approved = await ui.confirm('Plan Approval', planDisplay);
      if (!approved) {
        throw new GateDeniedError('plan-approval');
      }
    } else {
      ui.notify('[auto-accept] Plan approved.', 'info');
    }

    state.finalPlan = planText;
    state.step = 'task-writing';
    persist(agentDir, state);
    onProgress('planner: final plan stored');
  }

  // ── Task writing ───────────────────────────────────────────────────────────

  if (!state.taskGraph) {
    onProgress('task-writer: generating task list');
    const scoutSummary = formatScoutSummary(state.scoutResult);
    const taskOutput = await spawnAgent({
      modelId: pool['task-writer'],
      systemPrompt: taskWriterPrompt({
        finalPlan: state.finalPlan,
        scoutSummary,
        evidenceHint: state.spec?.evidenceHint ?? 'both',
      }),
      userPrompt: 'Write the task list for this plan.',
      cwd,
      signal,
    });

    const parsed = safeExtractJson(taskOutput, { tasks: [] });
    state.taskGraph = parsed;
    state.step = 'worktree';
    persist(agentDir, state);
    onProgress(`task-writer: ${parsed.tasks?.length ?? 0} tasks created`);
  }

  // ── Worktree setup ─────────────────────────────────────────────────────────

  if (!state.worktreePath) {
    onProgress('worktree: setting up');
    ensureWorktreesIgnored(repoRoot);
    const worktreePath = createWorktree(repoRoot, state.id);
    state.worktreePath = worktreePath;
    state.step = 'workers';
    persist(agentDir, state);
    onProgress(`worktree: ready at ${worktreePath}`);
  }

  // ── Workers ────────────────────────────────────────────────────────────────

  const cycleIndex = state.cycleIndex ?? 1;
  if (!state.workerResults || state.workerResults.length < (state.taskGraph?.tasks?.length ?? 0)) {
    onProgress('workers: executing tasks');
    const scoutSummary = formatScoutSummary(state.scoutResult);
    const workerResults = await executeWorkers({
      tasks: state.taskGraph.tasks,
      pool,
      scoutSummary,
      worktreePath: state.worktreePath,
      cycleIndex,
      agentDir,
      jobId: state.id,
      signal,
      onProgress,
    });

    state.workerResults = workerResults;

    // Handle failures: re-planning trigger
    const failed = workerResults.filter((r) => !r.success);
    if (failed.length > 0 && !state.replanCount) {
      state.replanCount = 0;
    }
    if (failed.length > 0) {
      state.replanCount = (state.replanCount ?? 0) + 1;
      onProgress(`workers: ${failed.length} task(s) failed — re-planning`);
      // Reset for re-plan
      state.taskGraph = undefined;
      state.finalPlan = undefined;
      state.step = 'planning';
      persist(agentDir, state);
      // Inject failure info into spec context for the re-plan
      state.spec = {
        ...state.spec,
        context: `${state.spec.context ?? ''}\n\nPREVIOUS ATTEMPT FAILURES:\n${formatFailures(failed)}`,
      };
      return runPipeline({ jobState: state, agentDir, config, ui, signal, onProgress });
    }

    state.step = 'proof';
    persist(agentDir, state);
  }

  // ── Proof compilation ──────────────────────────────────────────────────────

  if (!state.proofDeckPath) {
    onProgress('proof: compiling HTML deck');
    const artifacts = await collectArtifacts(state.workerResults, agentDir, state.id, cycleIndex);
    const html = generateProofHtml({
      jobId: state.id,
      goal: state.spec.goal,
      timestamp: Date.now(),
      cycleIndex,
      workerResults: artifacts,
      reviewNotes: state.reviewNotes,
      jesterCritique: state.reviewJesterCritique,
      plannerResolution: state.plannerResolution,
      previousDeckPath: state.previousProofDeckPath,
    });

    const deckPath = writeProofDeck(agentDir, state.id, cycleIndex, html);
    state.proofDeckPath = deckPath;
    state.step = 'review';
    persist(agentDir, state);
    onProgress(`proof: deck written to ${deckPath}`);
  }

  // ── Review loop ────────────────────────────────────────────────────────────

  if (!state.reviewVerdict) {
    onProgress('reviewer: reviewing worker output');
    const workerSummaries = (state.workerResults ?? [])
      .map((r) => `Task ${r.taskId}: ${r.success ? 'success' : 'failed'} — ${r.summary ?? ''}`)
      .join('\n');

    const reviewOutput = await spawnAgent({
      modelId: pool.reviewer,
      systemPrompt: reviewerPrompt({
        workerSummaries,
        plan: state.finalPlan,
        cycleIndex,
      }),
      userPrompt: 'Review the implementation.',
      cwd,
      signal,
    });

    const review = safeExtractJson(reviewOutput, {
      verdict: 'changes-required',
      taskReviews: [],
      overallNotes: reviewOutput,
    });

    onProgress('jester: critiquing the review');
    const jesterOutput = await spawnAgent({
      modelId: pool.jester,
      systemPrompt: jesterPrompt({ stage: 'review', content: reviewOutput }),
      userPrompt: 'Critique this review.',
      cwd,
      signal,
    });

    const jesterReview = safeExtractJson(jesterOutput, {
      verdict: 'acceptable',
      issues: [],
      summary: jesterOutput,
    });

    // Planner resolves jester critique of review
    let plannerResolution = '';
    if (jesterReview.verdict !== 'acceptable' && jesterReview.issues?.length > 0) {
      onProgress('planner: resolving jester critique of review');
      const resolutionOutput = await spawnAgent({
        modelId: pool.planner,
        systemPrompt: `You are the Planner. The jester has critiqued a code review. Decide:
1. Ask the worker for fixes (output: {"action":"worker-fix","instructions":"..."})
2. Update the review process (output: {"action":"process-update","description":"..."})`,
        userPrompt: `Review: ${reviewOutput}\n\nJester critique: ${jesterOutput}`,
        cwd,
        signal,
      });
      plannerResolution = resolutionOutput;
      const resolution = safeExtractJson(resolutionOutput, { action: 'worker-fix', instructions: '' });

      if (resolution.action === 'worker-fix') {
        // Reset for a new cycle
        state.previousProofDeckPath = state.proofDeckPath;
        state.proofDeckPath = undefined;
        state.workerResults = undefined;
        state.reviewVerdict = undefined;
        state.reviewNotes = undefined;
        state.reviewJesterCritique = undefined;
        state.plannerResolution = undefined;
        state.cycleIndex = cycleIndex + 1;
        state.spec = {
          ...state.spec,
          context: `${state.spec.context ?? ''}\n\nREVIEW REQUESTED FIXES:\n${resolution.instructions}`,
        };
        persist(agentDir, state);
        return runPipeline({ jobState: state, agentDir, config, ui, signal, onProgress });
      }
    }

    state.reviewVerdict = review.verdict;
    state.reviewNotes = review.overallNotes;
    state.reviewJesterCritique = jesterReview.summary;
    state.plannerResolution = plannerResolution;
    state.step = 'human-review';
    persist(agentDir, state);
  }

  // ── Human review gate ──────────────────────────────────────────────────────

  if (!state.humanApproved) {
    const gateMode = config.gates.proofReview.mode;
    if (gateMode === 'compulsory') {
      const approved = await ui.confirm(
        'Proof Review',
        `Review complete. Verdict: ${state.reviewVerdict}\n\nNotes: ${state.reviewNotes}\n\nProof deck: ${state.proofDeckPath}\n\nMerge into main branch?`,
      );
      if (!approved) {
        // User wants changes — treat as new cycle
        state.previousProofDeckPath = state.proofDeckPath;
        state.proofDeckPath = undefined;
        state.workerResults = undefined;
        state.reviewVerdict = undefined;
        state.reviewNotes = undefined;
        state.cycleIndex = cycleIndex + 1;
        persist(agentDir, state);
        throw new GateDeniedError('proof-review');
      }
    } else {
      ui.notify('[auto-accept] Proof review passed.', 'info');
    }

    state.humanApproved = true;
    persist(agentDir, state);
  }

  // ── Merge ──────────────────────────────────────────────────────────────────

  if (!state.merged) {
    onProgress('merge: merging worktree');
    mergeAndCleanWorktree(repoRoot, state.id, state.worktreePath);
    state.merged = true;
    state.step = 'retro';
    persist(agentDir, state);
    onProgress('merge: complete');
  }

  return state;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function callPlanner({ modelId, goal, interviewNotes, scoutSummary, cwd, signal }) {
  const output = await spawnAgent({
    modelId,
    systemPrompt: plannerInitialPrompt({ goal, interviewNotes, scoutSummary }),
    userPrompt: `Create the initial implementation plan for: ${goal}`,
    cwd,
    signal,
  });
  const parsed = safeExtractJson(output, { plan: output });
  return parsed.plan ?? output;
}

async function callPlannerRevise({ modelId, previousPlan, jesterCritique, round, cwd, signal }) {
  const output = await spawnAgent({
    modelId,
    systemPrompt: plannerRevisePrompt({ previousPlan, jesterCritique, round }),
    userPrompt: 'Revise the plan based on the jester critique.',
    cwd,
    signal,
  });
  const parsed = safeExtractJson(output, { plan: output });
  return parsed.plan ?? output;
}

async function executeWorkers({ tasks, pool, scoutSummary, worktreePath, cycleIndex, agentDir, jobId, signal, onProgress }) {
  const batches = resolveExecutionBatches(tasks);
  const allResults = [];

  for (const [batchIdx, batch] of batches.entries()) {
    onProgress(`workers: batch ${batchIdx + 1}/${batches.length} (${batch.length} tasks)`);

    const batchResults = await Promise.all(
      batch.map((task) =>
        executeOneWorker({ task, pool, scoutSummary, worktreePath, cycleIndex, agentDir, jobId, signal }),
      ),
    );

    allResults.push(...batchResults);
  }

  return allResults;
}

async function executeOneWorker({ task, pool, scoutSummary, worktreePath, cycleIndex, agentDir, jobId, signal }) {
  const artifactDir = getArtifactDir(agentDir, jobId, cycleIndex, task.id);

  let rawOutput;
  try {
    rawOutput = await spawnCodingAgent({
      modelId: pool.worker,
      systemPrompt: workerPrompt({ task, scoutSummary, cycleIndex }),
      userPrompt: `Execute task: ${task.title}\n\nSave all proof artifacts to: ${artifactDir}`,
      cwd: worktreePath,
      signal,
    });
  } catch (err) {
    return {
      taskId: task.id,
      success: false,
      failureReport: { attempted: task.title, found: 'agent error', reason: err.message },
      proofArtifacts: [],
      summary: `Agent error: ${err.message}`,
    };
  }

  const result = safeExtractJson(rawOutput, { status: 'failed', taskId: task.id, reason: rawOutput });

  if (result.status === 'failed') {
    return {
      taskId: task.id,
      success: false,
      failureReport: {
        attempted: result.attempted ?? task.title,
        found: result.found ?? '',
        reason: result.reason ?? rawOutput,
      },
      proofArtifacts: [],
      summary: result.reason ?? rawOutput,
    };
  }

  return {
    taskId: task.id,
    success: true,
    summary: result.summary ?? '',
    proofArtifacts: [],  // Populated by collectArtifacts() from disk
    artifactDir,
    artifactFiles: result.artifactFiles ?? [],
  };
}

async function collectArtifacts(workerResults, agentDir, jobId, cycleIndex) {
  return workerResults.map((result) => {
    const artifacts = [];
    if (!result.success) {
      return { ...result, proofArtifacts: artifacts };
    }

    const dir = result.artifactDir ?? getArtifactDir(agentDir, jobId, cycleIndex, result.taskId);
    for (const filename of result.artifactFiles ?? []) {
      const filePath = join(dir, filename);
      if (!existsSync(filePath)) continue;

      if (filename.endsWith('.log') || filename.endsWith('.txt')) {
        try {
          artifacts.push({
            type: 'log',
            content: readFileSync(filePath, 'utf-8'),
            description: filename,
          });
        } catch {
          // Skip unreadable files.
        }
      } else if (filename.match(/\.(png|jpg|jpeg|webp)$/i)) {
        try {
          const data = readFileSync(filePath);
          const mime = filename.endsWith('.png') ? 'image/png' : 'image/jpeg';
          artifacts.push({
            type: 'screenshot',
            content: data.toString('base64'),
            mimeType: mime,
            description: filename,
          });
        } catch {
          // Skip unreadable files.
        }
      }
    }

    return { ...result, proofArtifacts: artifacts };
  });
}

function safeExtractJson(text, fallback) {
  try {
    const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const candidate = fenceMatch ? fenceMatch[1].trim() : text.trim();
    return JSON.parse(candidate);
  } catch {
    return fallback;
  }
}

function formatScoutSummary(scoutResult) {
  if (!scoutResult) return 'No scout data available.';
  if (typeof scoutResult === 'string') return scoutResult;
  return [
    scoutResult.summary ?? '',
    scoutResult.dependencyMap ? `\nDependencies: ${scoutResult.dependencyMap}` : '',
    scoutResult.answers?.length
      ? `\nAnswers:\n${scoutResult.answers.map((a) => `- ${a.question}: ${a.answer}`).join('\n')}`
      : '',
  ]
    .join('')
    .trim();
}

function formatCritiqueHighlights(critiques) {
  return critiques
    .map((c, i) => {
      const parsed = safeExtractJson(c, { summary: c });
      return `Round ${i + 1}: ${parsed.summary ?? c}`;
    })
    .join('\n\n');
}

function formatFailures(failed) {
  return failed
    .map((r) => `- Task ${r.taskId}: ${r.failureReport?.reason ?? 'unknown failure'}`)
    .join('\n');
}

function persist(agentDir, state) {
  writeJobState(agentDir, { ...state, updatedAt: Date.now() });
}

export class GateDeniedError extends Error {
  constructor(gate) {
    super(`Gate denied: ${gate}`);
    this.gate = gate;
  }
}
