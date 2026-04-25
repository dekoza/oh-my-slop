import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  spawnAgent,
  spawnNamedAgent,
  spawnCodingAgent,
  extractJson,
  getBundledUiDesignSkillResource,
} from './agents.mjs';
import { getRoleThinkingLevel } from './thinking.mjs';
import { resolveExecutionBatches } from './tasks.mjs';
import { generateProofHtml } from './proof.mjs';
import { writeJobState, writeProofDeck, getArtifactDir } from './state.mjs';
import { buildReviewRepoContext, buildReviewTaskContext, resolveReviewCwd } from './review.mjs';
import { createWorktree, mergeAndCleanWorktree, findRepoRoot, ensureWorktreesIgnored } from './worktree.mjs';
import { acquireJobLock, releaseJobLock } from './job-locks.mjs';
import { formatUiDesignBrief, normalizePlannerUiAssessment, selectVisualDesignMode } from './ui-design.mjs';
import {
  scoutPrompt,
  plannerInitialPrompt,
  plannerRevisePrompt,
  jesterPrompt,
  taskWriterPrompt,
  workerPrompt,
  visualDesignerPrompt,
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
 *   planApprovalGate?: (options: { planText: string, critiqueHighlights: string, uiDesignBrief: string }) => Promise<boolean>,
 *   proofReviewGate?: (options: { reviewVerdict: string, reviewNotes: string, proofDeckPath: string }) => Promise<boolean>,
 *   onWorkerEvent?: (event: object) => void,
 *   signal?: AbortSignal,
 *   onProgress: (message: string) => void,
 *   lockHeld?: boolean,
 * }} options
 * @returns {Promise<object>}  Final job state
 */
export async function runPipeline({ jobState, agentDir, config, ui, planApprovalGate, proofReviewGate, onWorkerEvent, signal, onProgress, lockHeld = false }) {
  const state = { ...jobState };
  const pool = state.pool;
  const cwd = state.cwd ?? process.cwd();
  const repoRoot = findRepoRoot(cwd);
  const cycleIndex = state.cycleIndex ?? 1;
  const shouldManageLock = !lockHeld && typeof state.id === 'string' && state.id.trim().length > 0;

  if (shouldManageLock) {
    acquireJobLock(agentDir, state.id);
  }

  try {

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
    const scoutOutput = await runMonitoredReadonlyAgent({
      modelId: pool.scout,
      thinkingLevel: getRoleThinkingLevel('scout'),
      systemPrompt: scoutPrompt({ goal: state.spec.goal, questions: scoutQuestions }),
      userPrompt: `Reconnaissance mission for: ${state.spec.goal}`,
      cwd,
      signal,
      jobId: state.id,
      cycleIndex,
      taskId: `scout-cycle-${cycleIndex}`,
      title: `Scout — reconnaissance (cycle ${cycleIndex})`,
      onWorkerEvent,
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

    const planningAttempt = (state.replanCount ?? 0) + 1;
    state.planCritiques = [];
    let plannerResult = await callPlanner({
      modelId: pool.planner,
      goal: state.spec.goal,
      interviewNotes: state.spec.context ?? '',
      scoutSummary,
      jobId: state.id,
      cycleIndex,
      taskId: `planner-initial-attempt-${planningAttempt}`,
      title: `Planner — initial plan (attempt ${planningAttempt})`,
      onWorkerEvent,
      signal,
    });
    let planText = plannerResult.plan;
    let plannerUiAssessment = normalizePlannerUiAssessment(plannerResult.uiAssessment);

    for (let round = 1; round <= 2; round++) {
      onProgress(`jester: critique round ${round}`);
      const jesterOutput = await runMonitoredReadonlyAgent({
        modelId: pool.jester,
        thinkingLevel: getRoleThinkingLevel('jester'),
        systemPrompt: jesterPrompt({ stage: 'planning', content: planText }),
        userPrompt: 'Critique this plan.',
        cwd,
        signal,
        jobId: state.id,
        cycleIndex,
        taskId: `jester-planning-round-${round}-attempt-${planningAttempt}`,
        title: `Jester — planning critique round ${round} (attempt ${planningAttempt})`,
        onWorkerEvent,
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
        plannerResult = await callPlannerRevise({
          modelId: pool.planner,
          previousPlan: planText,
          jesterCritique: jesterOutput,
          round,
          cwd,
          signal,
          jobId: state.id,
          cycleIndex,
          taskId: `planner-revise-round-${round}-attempt-${planningAttempt}`,
          title: `Planner — revised plan round ${round} (attempt ${planningAttempt})`,
          onWorkerEvent,
        });
        planText = plannerResult.plan;
        plannerUiAssessment = normalizePlannerUiAssessment(plannerResult.uiAssessment);
      }
    }

    const uiModeSelection = selectVisualDesignMode({
      spec: state.spec,
      plannerUiAssessment,
      scoutResult: state.scoutResult,
    });
    const uiDesignSkill = getBundledUiDesignSkillResource();
    let uiDesignResult;
    let uiDesignBrief = '';

    if (uiModeSelection.required) {
      onProgress(`visual-designer: ${uiModeSelection.mode}`);
      const visualDesignerOutput = await runMonitoredReadonlyAgent({
        agentName: 'visual-designer',
        thinkingLevel: 'high',
        systemPrompt: visualDesignerPrompt({
          mode: uiModeSelection.mode,
          goal: state.spec.goal,
          interviewNotes: state.spec.context ?? '',
          scoutSummary,
          relevantUiFiles: uiModeSelection.coherenceFiles,
          uiDesignProposal: uiModeSelection.proposedDesign,
          targetSurface: uiModeSelection.targetSurface,
          skillFilePath: uiDesignSkill.filePath,
        }),
        userPrompt: `Prepare the ${uiModeSelection.mode} UI design guidance for this plan.`,
        cwd,
        signal,
        jobId: state.id,
        cycleIndex,
        taskId: `visual-designer-cycle-${cycleIndex}`,
        title: `Visual designer — ${uiModeSelection.mode} (cycle ${cycleIndex})`,
        onWorkerEvent,
        additionalSkills: [uiDesignSkill],
      });
      uiDesignResult = parseRequiredJson(visualDesignerOutput, 'visual-designer');
      uiDesignBrief = formatUiDesignBrief(uiDesignResult);
    }

    // Plan approval gate
    const gateMode = config.gates.planApproval.mode;
    const critiqueHighlights = formatCritiqueHighlights(state.planCritiques ?? []);
    if (gateMode === 'compulsory') {
      const approved = planApprovalGate
        ? await planApprovalGate({
            planText,
            critiqueHighlights,
            uiDesignBrief,
          })
        : await ui.confirm(
            'Plan Approval',
            `${planText}\n\n--- Jester highlights ---\n${critiqueHighlights}${uiDesignBrief ? `\n\n--- UI design brief ---\n${uiDesignBrief}` : ''}`,
          );
      if (!approved) {
        throw new GateDeniedError('plan-approval');
      }
    } else {
      ui.notify('[auto-accept] Plan approved.', 'info');
    }

    state.finalPlan = planText;
    state.plannerUiAssessment = plannerUiAssessment;
    state.uiRequired = uiModeSelection.required;
    state.uiDetectionReasons = uiModeSelection.reasons;
    state.uiDesign = uiDesignResult;
    state.step = 'task-writing';
    persist(agentDir, state);
    onProgress('planner: final plan stored');
  }

  // ── Task writing ───────────────────────────────────────────────────────────

  if (!state.taskGraph) {
    onProgress('task-writer: generating task list');
    const scoutSummary = formatScoutSummary(state.scoutResult);
    const taskOutput = await runMonitoredReadonlyAgent({
      modelId: pool['task-writer'],
      thinkingLevel: getRoleThinkingLevel('task-writer'),
      systemPrompt: taskWriterPrompt({
        finalPlan: state.finalPlan,
        scoutSummary,
        evidenceHint: state.spec?.evidenceHint ?? 'both',
        designBrief: state.uiDesign,
      }),
      userPrompt: 'Write the task list for this plan.',
      cwd,
      signal,
      jobId: state.id,
      cycleIndex,
      taskId: `task-writer-cycle-${cycleIndex}`,
      title: `Task writer — execution graph (cycle ${cycleIndex})`,
      onWorkerEvent,
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
      onWorkerEvent,
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
      state.planCritiques = undefined;
      state.plannerUiAssessment = undefined;
      state.uiRequired = undefined;
      state.uiDetectionReasons = undefined;
      state.uiDesign = undefined;
      state.step = 'planning';
      persist(agentDir, state);
      // Inject failure info into spec context for the re-plan
      state.spec = {
        ...state.spec,
        context: `${state.spec.context ?? ''}\n\nPREVIOUS ATTEMPT FAILURES:\n${formatFailures(failed)}`,
      };
      return runPipeline({ jobState: state, agentDir, config, ui, planApprovalGate, proofReviewGate, onWorkerEvent, signal, onProgress, lockHeld: true });
    }

    state.step = 'proof';
    persist(agentDir, state);
  }

  // ── Proof compilation ──────────────────────────────────────────────────────

  if (!state.proofDeckPath) {
    onProgress('proof: compiling HTML deck');
    const deckPath = await refreshProofDeck({ agentDir, state, cycleIndex });
    state.proofDeckPath = deckPath;
    state.step = 'review';
    persist(agentDir, state);
    onProgress(`proof: deck written to ${deckPath}`);
  }

  // ── Review loop ────────────────────────────────────────────────────────────

  if (!state.reviewVerdict) {
    onProgress('reviewer: reviewing worker output');
    const reviewTaskContext = buildReviewTaskContext(state.taskGraph, state.workerResults);
    const reviewRepoContext = buildReviewRepoContext({
      repoRoot,
      worktreePath: state.worktreePath,
    });

    const reviewOutput = await runMonitoredReadonlyAgent({
      modelId: pool.reviewer,
      thinkingLevel: getRoleThinkingLevel('reviewer'),
      systemPrompt: reviewerPrompt({
        taskContext: reviewTaskContext,
        repoContext: reviewRepoContext,
        plan: state.finalPlan,
        cycleIndex,
        proofDeckPath: state.proofDeckPath,
      }),
      userPrompt: 'Review the implementation.',
      cwd: resolveReviewCwd(state.worktreePath, cwd),
      signal,
      jobId: state.id,
      cycleIndex,
      taskId: `reviewer-cycle-${cycleIndex}`,
      title: `Reviewer — implementation review (cycle ${cycleIndex})`,
      onWorkerEvent,
    });

    const review = safeExtractJson(reviewOutput, {
      verdict: 'changes-required',
      taskReviews: [],
      findings: [],
      missingTests: [],
      openQuestions: [],
      evidenceSummary: '',
      overallNotes: reviewOutput,
    });

    onProgress('jester: critiquing the review');
    const jesterOutput = await runMonitoredReadonlyAgent({
      modelId: pool.jester,
      thinkingLevel: getRoleThinkingLevel('jester'),
      systemPrompt: jesterPrompt({ stage: 'review', content: reviewOutput }),
      userPrompt: 'Critique this review.',
      cwd,
      signal,
      jobId: state.id,
      cycleIndex,
      taskId: `jester-review-cycle-${cycleIndex}`,
      title: `Jester — review critique (cycle ${cycleIndex})`,
      onWorkerEvent,
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
      const resolutionOutput = await runMonitoredReadonlyAgent({
        modelId: pool.planner,
        thinkingLevel: getRoleThinkingLevel('planner'),
        systemPrompt: `You are the Planner. The jester has critiqued a code review. Decide:
1. Ask the worker for fixes (output: {"action":"worker-fix","instructions":"..."})
2. Update the review process (output: {"action":"process-update","description":"..."})`,
        userPrompt: `Review: ${reviewOutput}\n\nJester critique: ${jesterOutput}`,
        cwd,
        signal,
        jobId: state.id,
        cycleIndex,
        taskId: `planner-review-resolution-cycle-${cycleIndex}`,
        title: `Planner — review resolution (cycle ${cycleIndex})`,
        onWorkerEvent,
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
        state.reviewFindings = undefined;
        state.reviewMissingTests = undefined;
        state.reviewOpenQuestions = undefined;
        state.reviewEvidenceSummary = undefined;
        state.reviewJesterCritique = undefined;
        state.plannerResolution = undefined;
        state.cycleIndex = cycleIndex + 1;
        state.spec = {
          ...state.spec,
          context: `${state.spec.context ?? ''}\n\nREVIEW REQUESTED FIXES:\n${resolution.instructions}`,
        };
        persist(agentDir, state);
        return runPipeline({ jobState: state, agentDir, config, ui, planApprovalGate, proofReviewGate, onWorkerEvent, signal, onProgress, lockHeld: true });
      }
    }

    state.reviewVerdict = review.verdict;
    state.reviewNotes = review.overallNotes;
    state.reviewFindings = Array.isArray(review.findings) ? review.findings : [];
    state.reviewMissingTests = Array.isArray(review.missingTests) ? review.missingTests : [];
    state.reviewOpenQuestions = Array.isArray(review.openQuestions) ? review.openQuestions : [];
    state.reviewEvidenceSummary = review.evidenceSummary ?? '';
    state.reviewJesterCritique = jesterReview.summary;
    state.plannerResolution = plannerResolution;
    if (state.proofDeckPath) {
      onProgress('proof: refreshing deck with review findings');
      state.proofDeckPath = await refreshProofDeck({ agentDir, state, cycleIndex });
    }
    state.step = 'human-review';
    persist(agentDir, state);
  }

  // ── Human review gate ──────────────────────────────────────────────────────

  if (!state.humanApproved) {
    const gateMode = config.gates.proofReview.mode;
    if (gateMode === 'compulsory') {
      const approved = proofReviewGate
        ? await proofReviewGate({
            reviewVerdict: String(state.reviewVerdict ?? ''),
            reviewNotes: String(state.reviewNotes ?? ''),
            proofDeckPath: String(state.proofDeckPath ?? ''),
          })
        : await ui.confirm(
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
        state.reviewFindings = undefined;
        state.reviewMissingTests = undefined;
        state.reviewOpenQuestions = undefined;
        state.reviewEvidenceSummary = undefined;
        state.reviewJesterCritique = undefined;
        state.plannerResolution = undefined;
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
  } finally {
    if (shouldManageLock) {
      releaseJobLock(agentDir, state.id);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function runMonitoredReadonlyAgent({
  modelId,
  agentName,
  thinkingLevel,
  systemPrompt,
  userPrompt,
  cwd,
  signal,
  jobId,
  cycleIndex,
  taskId,
  title,
  onWorkerEvent,
  additionalContextFiles,
  additionalSkills,
}) {
  const emitLog = (text) => {
    onWorkerEvent?.({
      type: 'worker-log',
      jobId,
      cycleIndex,
      taskId,
      title,
      text,
    });
  };

  onWorkerEvent?.({
    type: 'worker-started',
    jobId,
    cycleIndex,
    taskId,
    title,
  });

  try {
    const spawn = agentName ? spawnNamedAgent : spawnAgent;
    const output = await spawn({
      ...(agentName ? { agentName } : { modelId }),
      thinkingLevel,
      systemPrompt,
      userPrompt,
      cwd,
      signal,
      onLogLine: (line) => emitLog(`${line}\n`),
      additionalContextFiles,
      additionalSkills,
    });
    onWorkerEvent?.({
      type: 'worker-finished',
      jobId,
      cycleIndex,
      taskId,
      status: 'success',
    });
    return output;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    emitLog(`Agent error: ${errorMessage}\n`);
    onWorkerEvent?.({
      type: 'worker-finished',
      jobId,
      cycleIndex,
      taskId,
      status: 'failed',
    });
    throw err;
  }
}

async function callPlanner({ modelId, goal, interviewNotes, scoutSummary, cwd, signal, jobId, cycleIndex, taskId, title, onWorkerEvent }) {
  const output = await runMonitoredReadonlyAgent({
    modelId,
    thinkingLevel: getRoleThinkingLevel('planner'),
    systemPrompt: plannerInitialPrompt({ goal, interviewNotes, scoutSummary }),
    userPrompt: `Create the initial implementation plan for: ${goal}`,
    cwd,
    signal,
    jobId,
    cycleIndex,
    taskId,
    title,
    onWorkerEvent,
  });
  const parsed = safeExtractJson(output, { plan: output, uiAssessment: { touchesUi: false } });
  return {
    plan: parsed.plan ?? output,
    uiAssessment: parsed.uiAssessment ?? { touchesUi: false },
  };
}

async function callPlannerRevise({ modelId, previousPlan, jesterCritique, round, cwd, signal, jobId, cycleIndex, taskId, title, onWorkerEvent }) {
  const output = await runMonitoredReadonlyAgent({
    modelId,
    thinkingLevel: getRoleThinkingLevel('planner'),
    systemPrompt: plannerRevisePrompt({ previousPlan, jesterCritique, round }),
    userPrompt: 'Revise the plan based on the jester critique.',
    cwd,
    signal,
    jobId,
    cycleIndex,
    taskId,
    title,
    onWorkerEvent,
  });
  const parsed = safeExtractJson(output, { plan: output, uiAssessment: { touchesUi: false } });
  return {
    plan: parsed.plan ?? output,
    uiAssessment: parsed.uiAssessment ?? { touchesUi: false },
  };
}

async function executeWorkers({ tasks, pool, scoutSummary, worktreePath, cycleIndex, agentDir, jobId, signal, onProgress, onWorkerEvent }) {
  const batches = resolveExecutionBatches(tasks);
  const allResults = [];

  for (const task of tasks) {
    onWorkerEvent?.({
      type: 'worker-queued',
      jobId,
      cycleIndex,
      taskId: task.id,
      title: task.title,
    });
  }

  for (const [batchIdx, batch] of batches.entries()) {
    onProgress(`workers: batch ${batchIdx + 1}/${batches.length} (${batch.length} tasks)`);

    const batchResults = await Promise.all(
      batch.map((task) =>
        executeOneWorker({
          task,
          pool,
          scoutSummary,
          worktreePath,
          cycleIndex,
          agentDir,
          jobId,
          signal,
          onWorkerEvent,
        }),
      ),
    );

    allResults.push(...batchResults);
  }

  return allResults;
}

async function executeOneWorker({ task, pool, scoutSummary, worktreePath, cycleIndex, agentDir, jobId, signal, onWorkerEvent }) {
  const artifactDir = getArtifactDir(agentDir, jobId, cycleIndex, task.id);
  const emitWorkerLog = (text) => {
    onWorkerEvent?.({
      type: 'worker-log',
      jobId,
      cycleIndex,
      taskId: task.id,
      title: task.title,
      text,
    });
  };

  onWorkerEvent?.({
    type: 'worker-started',
    jobId,
    cycleIndex,
    taskId: task.id,
    title: task.title,
  });

  let rawOutput;
  try {
    rawOutput = await spawnCodingAgent({
      modelId: pool.worker,
      thinkingLevel: getRoleThinkingLevel('worker'),
      systemPrompt: workerPrompt({ task, scoutSummary, cycleIndex }),
      userPrompt: `Execute task: ${task.title}\n\nSave all proof artifacts to: ${artifactDir}`,
      cwd: worktreePath,
      signal,
      onLogLine: (line) => emitWorkerLog(`${line}\n`),
    });
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    emitWorkerLog(`Agent error: ${errorMessage}\n`);
    onWorkerEvent?.({
      type: 'worker-finished',
      jobId,
      cycleIndex,
      taskId: task.id,
      status: 'failed',
    });
    return {
      taskId: task.id,
      success: false,
      failureReport: { attempted: task.title, found: 'agent error', reason: errorMessage },
      proofArtifacts: [],
      summary: `Agent error: ${errorMessage}`,
    };
  }

  const result = safeExtractJson(rawOutput, { status: 'failed', taskId: task.id, reason: rawOutput });

  if (result.status === 'failed') {
    emitWorkerLog(`Failure reason: ${result.reason ?? rawOutput}\n`);
    onWorkerEvent?.({
      type: 'worker-finished',
      jobId,
      cycleIndex,
      taskId: task.id,
      status: 'failed',
    });
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

  emitWorkerLog(`Summary: ${result.summary ?? '(none provided)'}\n`);
  if (Array.isArray(result.artifactFiles) && result.artifactFiles.length > 0) {
    emitWorkerLog(`Artifacts: ${result.artifactFiles.join(', ')}\n`);
  }
  onWorkerEvent?.({
    type: 'worker-finished',
    jobId,
    cycleIndex,
    taskId: task.id,
    status: 'success',
  });

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

async function refreshProofDeck({ agentDir, state, cycleIndex }) {
  const artifacts = await collectArtifacts(state.workerResults ?? [], agentDir, state.id, cycleIndex);
  const html = generateProofHtml({
    jobId: state.id,
    goal: state.spec.goal,
    timestamp: Date.now(),
    cycleIndex,
    workerResults: artifacts,
    reviewNotes: state.reviewNotes,
    reviewFindings: state.reviewFindings,
    reviewMissingTests: state.reviewMissingTests,
    reviewOpenQuestions: state.reviewOpenQuestions,
    reviewEvidenceSummary: state.reviewEvidenceSummary,
    jesterCritique: state.reviewJesterCritique,
    plannerResolution: state.plannerResolution,
    previousDeckPath: state.previousProofDeckPath,
  });

  return writeProofDeck(agentDir, state.id, cycleIndex, html);
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

function parseRequiredJson(text, label) {
  try {
    return extractJson(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} returned invalid JSON: ${message}`);
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
