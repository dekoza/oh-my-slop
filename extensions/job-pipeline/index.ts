import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir, DynamicBorder } from "@mariozechner/pi-coding-agent";
import { type SelectItem, SelectList, Text, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "typebox";

import { normalizeJobPipelineConfig, DEFAULT_JOB_PIPELINE_CONFIG } from "./lib/config.mjs";
import { drawSessionPool } from "./lib/pool.mjs";
import {
  readJobState,
  writeJobState,
  clearJobState,
  readAutonomyState,
  writeAutonomyState,
  getConfigPath,
} from "./lib/state.mjs";
import { recordCleanRetro, recordRetroWithChanges, shouldSuggestAutonomy } from "./lib/autonomy.mjs";
import { executeCleanup, formatCleanupPlan, planCleanup } from "./lib/cleanup.mjs";
import { runDoctor, formatDoctorReport } from "./lib/doctor.mjs";
import { startTrackedJob, captureInterviewSpec, recordPoolDraw } from "./lib/job-lifecycle.mjs";
import { runPipeline, GateDeniedError } from "./lib/pipeline.mjs";
import {
  interviewSystemAddition,
  pipelineOrchestratorAddition,
  retroPrompt,
} from "./lib/prompts.mjs";
import {
  buildRetroWritePrompt,
  buildJesterFlagsWritePrompt,
} from "./lib/swampcastle.mjs";
import { listJobs, loadJobSnapshot } from "./lib/job-store.mjs";
import {
  buildBrowserOpenCommand,
  normalizeCycleFilter,
  parseJobWorkersArgs,
} from "./lib/worker-inspector.mjs";
import { spawnAgent, extractJson } from "./lib/agents.mjs";
import { getRoleThinkingLevel } from "./lib/thinking.mjs";
import {
  buildInterviewCapturedMessage,
  createInitialJobState,
  formatPipelineError,
} from "./lib/runtime-helpers.mjs";
import {
  buildPlanApprovalDialogSpec,
  buildProofReviewDialogSpec,
  buildRetroReviewDialogSpec,
  ScrollableApprovalDialogState,
  wrapPlainText,
} from "./lib/plan-approval-dialog.mjs";
import {
  applyWorkerMonitorEvent,
  buildPersistedWorkerMonitorState,
  createWorkerMonitorState,
  getWorkerLogLines,
  resetWorkerMonitorState,
  wrapWorkerLogLines,
} from "./lib/worker-monitor.mjs";
import { resolveJobScopePath } from "./lib/job-scope.mjs";

const STATUS_KEY = "job-pipeline";

type JobMode = "idle" | "interview" | "awaiting-run-confirmation" | "pipeline-ready" | "running" | "retro";

type WorkerLogEntry = {
  key: string;
  cycleIndex: number;
  taskId: string;
  title: string;
  status: "pending" | "queued" | "running" | "success" | "failed";
  logLines: string[];
  pendingLogLine: string;
  sourcePath?: string;
  sourceType?: "text" | "html";
  browserPath?: string;
};

type WorkerMonitorState = {
  jobId?: string;
  workers: WorkerLogEntry[];
};

type RuntimeState = {
  mode: JobMode;
  capturedCtx?: ExtensionContext;
  jobSpec?: Record<string, unknown>;
  workerMonitor: WorkerMonitorState;
  workerViewerRequestRender?: () => void;
  workerLogsHintShown: boolean;
};

type ScrollableGateDialogSpec = {
  title: string;
  body: string;
  question: string;
  approveLabel: string;
  denyLabel: string;
};

export default function jobPipelineExtension(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  const runtime: RuntimeState = {
    mode: "idle",
    workerMonitor: createWorkerMonitorState(),
    workerLogsHintShown: false,
  };

  function getRepoRoot(cwd?: string): string | undefined {
    const repoRoot = resolveJobScopePath(cwd);
    return typeof repoRoot === "string" && repoRoot.trim().length > 0 ? repoRoot : undefined;
  }

  function readScopedJobState(cwd?: string): Record<string, unknown> | null {
    const repoRoot = getRepoRoot(cwd);
    return readJobState(agentDir, repoRoot ? { repoRoot } : cwd ? { cwd } : undefined) as Record<string, unknown> | null;
  }

  function writeScopedJobState(state: Record<string, unknown>, cwd?: string): void {
    const repoRoot = getRepoRoot(cwd ?? (state.cwd as string | undefined));
    writeJobState(agentDir, state, repoRoot ? { repoRoot } : undefined);
  }

  function clearScopedJobState(cwd?: string): void {
    const repoRoot = getRepoRoot(cwd);
    clearJobState(agentDir, repoRoot ? { repoRoot } : undefined);
  }

  // ── Capture ctx for use in background async pipeline ──────────────────────

  function captureCtx(ctx: ExtensionContext): void {
    runtime.capturedCtx = ctx;
  }

  function recordWorkerEvent(event: Record<string, unknown>): void {
    applyWorkerMonitorEvent(runtime.workerMonitor, event);
    if (!runtime.workerLogsHintShown && event.type === "worker-started" && runtime.capturedCtx?.hasUI) {
      runtime.capturedCtx.ui.notify("Job agents are running. Use /job-workers to inspect live logs.", "info");
      runtime.workerLogsHintShown = true;
    }
    runtime.workerViewerRequestRender?.();
  }

  pi.on("session_start", (_, ctx) => captureCtx(ctx));
  pi.on("before_agent_start", (_, ctx) => captureCtx(ctx));
  pi.on("agent_end", (_, ctx) => captureCtx(ctx));

  // ── Interview system prompt injection ─────────────────────────────────────

  pi.on("before_agent_start", async (event, ctx) => {
    if (runtime.mode === "interview") {
      const jobState = readScopedJobState(ctx.cwd);
      const description = (jobState?.description as string) ?? "";
      return {
        systemPrompt:
          event.systemPrompt + "\n\n" + interviewSystemAddition({ description }),
      };
    }

    if (runtime.mode === "pipeline-ready" && runtime.jobSpec) {
      return {
        systemPrompt:
          event.systemPrompt +
          "\n\n" +
          pipelineOrchestratorAddition({ spec: runtime.jobSpec }),
      };
    }
  });

  // ── job_interview_complete tool ────────────────────────────────────────────

  pi.registerTool({
    name: "job_interview_complete",
    label: "Complete Job Interview",
    description:
      "Call this when the brain-dump interview is complete and the user has confirmed they are ready to proceed. Captures the structured job specification.",
    promptSnippet: "Complete a job interview and capture the spec",
    promptGuidelines: [
      "Use job_interview_complete when you have finished gathering requirements and the user is ready to start the pipeline.",
    ],
    parameters: Type.Object({
      goal: Type.String({ description: "Full, specific goal description" }),
      context: Type.String({ description: "Key context gathered during the interview" }),
      constraints: Type.Array(Type.String(), { description: "Known constraints and requirements" }),
      outOfScope: Type.Array(Type.String(), { description: "What is explicitly out of scope" }),
      questionsToScout: Type.Array(Type.String(), {
        description: "Specific questions the scout should answer about the codebase",
      }),
      evidenceHint: Type.Union(
        [Type.Literal("screenshots"), Type.Literal("logs"), Type.Literal("both")],
        { description: "What type of evidence workers should produce" },
      ),
      proposedUiDesign: Type.Optional(Type.String({
        description: "Optional user-provided UI concept, layout idea, or visual direction to critique",
      })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const spec = params;
      const approvedToRun = await ctx.ui.confirm(
        "Start Job Pipeline",
        buildInterviewStartConfirmationText(spec),
      );

      runtime.jobSpec = spec;
      runtime.mode = approvedToRun ? "pipeline-ready" : "awaiting-run-confirmation";

      const jobState = readScopedJobState(ctx.cwd);
      if (jobState) {
        captureInterviewSpec(agentDir, jobState, spec, {
          now: Date.now(),
          step: approvedToRun ? "pipeline-ready" : "awaiting-run-confirmation",
        });
      }

      ctx.ui.notify("Interview complete. Spec captured.", "success");
      ctx.ui.setStatus(STATUS_KEY, approvedToRun ? "pipeline ready" : "awaiting confirmation");

      return {
        content: [{ type: "text", text: buildInterviewCapturedMessage({ approvedToRun }) }],
      };
    },
  });

  // ── job_run_pipeline tool ─────────────────────────────────────────────────

  pi.registerTool({
    name: "job_run_pipeline",
    label: "Run Job Pipeline",
    description:
      "Execute the full job pipeline: scout → planning loop → task writing → workers → review → merge → retro. Long-running.",
    promptSnippet: "Run the full job pipeline",
    promptGuidelines: [
      "Call job_run_pipeline immediately after the job interview is complete and the spec is captured.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, signal, onUpdate, ctx) {
      const jobState = readScopedJobState(ctx.cwd);
      if (!jobState) {
        return {
          content: [{ type: "text", text: "No active job state found for this repository. Start a job with /job first." }],
          isError: true,
        };
      }

      if (jobState.step === "awaiting-run-confirmation") {
        return {
          content: [{ type: "text", text: "The interview spec is captured, but the pipeline does not have start approval yet. Run /job to confirm when ready." }],
          isError: true,
        };
      }

      const config = loadConfig(agentDir);
      const availableModels = ctx.modelRegistry
        .getAvailable()
        .map((m: { provider: string; id: string }) => `${m.provider}/${m.id}`);

      // Draw session pool if not already drawn
      let state = jobState as Record<string, unknown>;
      if (!state.pool) {
        try {
          const pool = drawSessionPool(config, availableModels);
          state = recordPoolDraw(agentDir, state, pool, { now: Date.now() });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.ui.notify(`Pool draw failed: ${msg}`, "error");
          return { content: [{ type: "text", text: `Pool draw failed: ${msg}` }], isError: true };
        }
      }

      runtime.mode = "running";
      if (runtime.workerMonitor.jobId && runtime.workerMonitor.jobId !== (state.id as string)) {
        resetWorkerMonitorState(runtime.workerMonitor, state.id as string);
        runtime.workerLogsHintShown = false;
      }
      ctx.ui.setStatus(STATUS_KEY, "running");

      const steps: string[] = [];
      try {
        const finalState = await runPipeline({
          jobState: state,
          agentDir,
          config,
          ui: ctx.ui,
          planApprovalGate: ({ planText, critiqueHighlights, uiDesignBrief }) =>
            showScrollableGateDialog(
              ctx.ui,
              buildPlanApprovalDialogSpec({ planText, critiqueHighlights, uiDesignBrief }),
            ),
          proofReviewGate: ({ reviewVerdict, reviewNotes, proofDeckPath }) =>
            showScrollableGateDialog(
              ctx.ui,
              buildProofReviewDialogSpec({
                verdict: reviewVerdict,
                notes: reviewNotes,
                proofDeckPath,
              }),
            ),
          onWorkerEvent: (event: Record<string, unknown>) => recordWorkerEvent(event),
          signal,
          onProgress: (message: string) => {
            steps.push(message);
            ctx.ui.setStatus(STATUS_KEY, message);
            onUpdate?.({ content: [{ type: "text", text: `▶ ${message}\n` }] });
          },
        });

        // ── Retro ────────────────────────────────────────────────────────────
        await runRetroLocal(finalState, ctx, signal);

        runtime.mode = "idle";
        ctx.ui.setStatus(STATUS_KEY, "done");

        return {
          content: [
            {
              type: "text",
              text: `Pipeline complete.\nProof deck: ${finalState.proofDeckPath}\nSteps: ${steps.join(" → ")}`,
            },
          ],
        };
      } catch (err) {
        runtime.mode = "idle";
        if (err instanceof GateDeniedError) {
          ctx.ui.setStatus(STATUS_KEY, `paused at ${err.gate}`);
          return {
            content: [{ type: "text", text: `Pipeline paused: gate denied at ${err.gate}. Run /job to resume.` }],
          };
        }
        const formatted = formatPipelineError(err);
        ctx.ui.setStatus(STATUS_KEY, "error");
        return {
          content: [{ type: "text", text: formatted.text }],
          details: formatted.details,
          isError: true,
        };
      }
    },
  });

  // ── /job command ──────────────────────────────────────────────────────────

  pi.registerCommand("job", {
    description:
      "Start a new job or resume an interrupted one. Usage: /job [description]",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const currentRepoRoot = getRepoRoot(ctx.cwd);
      const existing = readScopedJobState(ctx.cwd);

      if (existing && !existing.repoRoot && typeof existing.cwd === "string") {
        existing.repoRoot = getRepoRoot(existing.cwd);
        existing.updatedAt = Date.now();
        writeScopedJobState(existing, existing.cwd as string);
      }

      // Offer resume if there's an active job for this repository.
      if (existing && existing.step && existing.step !== "done") {
        const resume = await ctx.ui.confirm(
          "Resume Job",
          `Found interrupted job in this repository: "${existing.description}"\nStep: ${existing.step}\nRepo: ${existing.repoRoot ?? existing.cwd ?? "unknown"}\n\nResume it?`,
        );
        if (resume) {
          const step = existing.step as string;
          if (runtime.workerMonitor.jobId && runtime.workerMonitor.jobId !== (existing.id as string)) {
            resetWorkerMonitorState(runtime.workerMonitor, existing.id as string);
            runtime.workerLogsHintShown = false;
            runtime.workerViewerRequestRender?.();
          }
          if (step === "interview") {
            runtime.mode = "interview";
            runtime.jobSpec = existing.spec as Record<string, unknown>;
            pi.sendUserMessage("We were in the middle of a planning interview. Please continue where we left off.");
            ctx.ui.setStatus(STATUS_KEY, "interview");
            return;
          }
          if (step === "awaiting-run-confirmation") {
            const approvedToRun = await ctx.ui.confirm(
              "Start Job Pipeline",
              buildInterviewStartConfirmationText(existing.spec as Record<string, unknown>),
            );
            if (!approvedToRun) {
              runtime.mode = "awaiting-run-confirmation";
              runtime.jobSpec = existing.spec as Record<string, unknown>;
              ctx.ui.setStatus(STATUS_KEY, "awaiting confirmation");
              ctx.ui.notify("The interview is captured. The pipeline will stay paused until you confirm start.", "info");
              return;
            }

            const approvedState = {
              ...existing,
              step: "pipeline-ready",
              updatedAt: Date.now(),
            };
            writeScopedJobState(approvedState, ctx.cwd);
            runtime.mode = "pipeline-ready";
            runtime.jobSpec = approvedState.spec as Record<string, unknown>;
            pi.sendUserMessage("The interview is complete and approved. Start the pipeline now.", { deliverAs: "followUp" });
            ctx.ui.setStatus(STATUS_KEY, "resuming");
            return;
          }
          // Pipeline steps
          runtime.mode = "pipeline-ready";
          runtime.jobSpec = existing.spec as Record<string, unknown>;
          pi.sendUserMessage("Resuming the pipeline from the last checkpoint.", { deliverAs: "followUp" });
          ctx.ui.setStatus(STATUS_KEY, "resuming");
          return;
        }
        // Abandon existing job for this repository only.
        clearScopedJobState(ctx.cwd);
      }

      // Start new job
      const description = args.trim() || "";
      const jobId = `job-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
      const initialState = startTrackedJob(agentDir, createInitialJobState({
        id: jobId,
        description,
        cwd: ctx.cwd,
        repoRoot: currentRepoRoot,
      }));
      pi.setSessionName(`job: ${description || jobId}`);

      resetWorkerMonitorState(runtime.workerMonitor, jobId);
      runtime.workerLogsHintShown = false;
      runtime.workerViewerRequestRender?.();
      runtime.mode = "interview";
      runtime.jobSpec = undefined;

      ctx.ui.setStatus(STATUS_KEY, "interview");
      ctx.ui.notify(`Job ${jobId} started. Interview beginning...`, "info");

      const openingMessage = description
        ? `We're planning: "${description}". Let's drill down into the details.`
        : "What's on your mind?";

      pi.sendUserMessage(openingMessage);
    },
  });

  // ── /job-pool command ─────────────────────────────────────────────────────

  pi.registerCommand("job-pool", {
    description: "Configure model pools. ←→ cycle roles, ↑↓/type to pick models.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const config = loadConfig(agentDir);
      const allModels = ctx.modelRegistry
        .getAvailable()
        .map((m: { provider: string; id: string; name: string }) => ({
          fullId: `${m.provider}/${m.id}`,
          name: m.name,
          provider: m.provider,
        }));

      if (allModels.length === 0) {
        ctx.ui.notify("No models available. Log in to a provider first.", "warning");
        return;
      }

      const ALL_ROLES = ["scout", "planner", "jester", "task-writer", "worker", "reviewer"] as const;
      const ROLE_LABELS: Record<string, string> = {
        scout:         "cheap — read-only recon",
        planner:       "expensive — drives planning loop",
        jester:        "adversarial critic (must differ from planner)",
        "task-writer": "generates worker task list",
        worker:        "cheap — TDD implementation",
        reviewer:      "expensive — final quality gate",
      };

      const subArg = args.trim().toLowerCase();
      const targetRoles: string[] = subArg && ALL_ROLES.includes(subArg as typeof ALL_ROLES[number])
        ? [subArg]
        : [...ALL_ROLES];

      // Track selections per role, initialised from current config.
      const selectedByRole = new Map<string, Set<string>>(
        targetRoles.map((r) => [
          r,
          new Set<string>(config.pools[r as keyof typeof config.pools]?.models ?? []),
        ]),
      );

      const result = await ctx.ui.custom<Record<string, string[]> | null>(
        (tui, theme, keybindings, done) => {
          let roleIdx = 0;
          let query = "";

          const topBorder    = new DynamicBorder((s: string) => theme.fg("accent", s));
          const bottomBorder = new DynamicBorder((s: string) => theme.fg("accent", s));
          const helpText = new Text(
            theme.fg("dim",
              targetRoles.length > 1
                ? "↑↓ navigate  ⏎ toggle  type filter  ← → role  esc save"
                : "↑↓ navigate  ⏎ toggle  type filter  esc save",
            ),
            1, 0,
          );

          function currentRole(): string { return targetRoles[roleIdx]; }
          function currentSelected(): Set<string> { return selectedByRole.get(currentRole())!; }

          function allDone(): Record<string, string[]> {
            return Object.fromEntries([...selectedByRole].map(([k, v]) => [k, [...v]]));
          }

          function buildItems(): SelectItem[] {
            const sel = currentSelected();
            return [
              { value: "__done__", label: "✓ Save and close" },
              ...allModels.map((m) => ({
                value: m.fullId,
                label: (sel.has(m.fullId) ? "✓ " : "  ") + m.name,
                description: m.fullId,
              })),
            ];
          }

          // SelectList is recreated whenever items change (after toggle or role switch).
          // We use a `let` so render/handleInput always dereference the current instance.
          let selectList = makeSelectList(buildItems());

          function makeSelectList(items: SelectItem[]): SelectList {
            const sl = new SelectList(items, 12, {
              selectedPrefix: (s) => theme.fg("accent", s),
              selectedText:   (s) => theme.fg("accent", s),
              description:    (s) => theme.fg("dim", s),
              scrollInfo:     (s) => theme.fg("dim", s),
              noMatch:        (s) => theme.fg("warning", s),
            });
            if (query) sl.setFilter(query);
            sl.onSelect = (item) => {
              if (item.value === "__done__") { done(allDone()); return; }
              const sel = currentSelected();
              if (sel.has(item.value)) sel.delete(item.value); else sel.add(item.value);
              selectList = makeSelectList(buildItems());
              tui.requestRender();
            };
            sl.onCancel = () => done(allDone());
            return sl;
          }

          function roleHeader(): string {
            const role = currentRole();
            const count = currentSelected().size;
            const nav = targetRoles.length > 1 ? `← ${role} →` : role;
            const countStr = count > 0
              ? theme.fg("accent", `  ${count} model${count === 1 ? "" : "s"}`)
              : theme.fg("dim", "  (empty)");
            return ` ${theme.bold(nav)}${countStr}  ${theme.fg("muted", ROLE_LABELS[role] ?? "")}`;
          }

          return {
            render: (w) => [
              ...topBorder.render(w),
              roleHeader(),
              ` ${theme.fg("dim", "Filter: ")}${theme.fg("accent", query)}█`,
              ...selectList.render(w),
              ...helpText.render(w),
              ...bottomBorder.render(w),
            ],
            invalidate: () => {
              topBorder.invalidate();
              bottomBorder.invalidate();
              helpText.invalidate();
              selectList.invalidate();
            },
            handleInput: (data) => {
              if (keybindings.matches(data, "tui.editor.cursorLeft")) {
                roleIdx = (roleIdx - 1 + targetRoles.length) % targetRoles.length;
                query = "";
                selectList = makeSelectList(buildItems());
              } else if (keybindings.matches(data, "tui.editor.cursorRight")) {
                roleIdx = (roleIdx + 1) % targetRoles.length;
                query = "";
                selectList = makeSelectList(buildItems());
              } else if (data.length === 1 && data.charCodeAt(0) >= 32 && data.charCodeAt(0) < 127) {
                query += data;
                selectList.setFilter(query);
              } else if (data === "\x7f" || data === "\b") {   // backspace
                query = query.slice(0, -1);
                selectList.setFilter(query);
              } else {
                selectList.handleInput(data);
              }
              tui.requestRender();
            },
          };
        },
        { overlay: true, overlayOptions: { anchor: "center", width: 72, maxHeight: 22 } },
      );

      if (result) {
        const updatedPools = structuredClone(config.pools) as Record<string, { models: string[] }>;
        for (const [role, models] of Object.entries(result)) {
          updatedPools[role] = { models };
        }
        saveConfig(agentDir, { ...config, pools: updatedPools });
        ctx.ui.notify("Pool configuration saved.", "success");
      }
    },
  });

  // ── /job-status command ───────────────────────────────────────────────────

  pi.registerCommand("job-status", {
    description: "Show current job state and pipeline step.",
    handler: async (args, ctx) => {
      const state = readScopedJobState(ctx.cwd);
      if (!state) {
        ctx.ui.notify("No active job for this repository. Start one with /job.", "info");
        return;
      }

      const lines = [
        `Job: ${state.id}`,
        `Description: ${state.description}`,
        `Step: ${state.step}`,
        `Cycle: ${state.cycleIndex ?? 1}`,
        `Re-plans: ${state.replanCount ?? 0}`,
        `Created: ${new Date((state.createdAt as number) ?? 0).toISOString()}`,
      ];

      if (state.pool) {
        lines.push("Pool:");
        for (const [role, model] of Object.entries(state.pool as Record<string, string>)) {
          lines.push(`  ${role}: ${model}`);
        }
      }

      if (state.proofDeckPath) {
        lines.push(`Proof deck: ${state.proofDeckPath}`);
      }

      ctx.ui.notify(lines.join("\n"), "info");
    },
  });

  // ── /job-workers command ──────────────────────────────────────────────────

  pi.registerCommand("job-workers", {
    description: "Open the agent inspector. Usage: /job-workers [job-id] [--cycle N|all]",
    handler: async (args, ctx) => {
      if (runtime.workerViewerRequestRender) {
        ctx.ui.notify("Agent log viewer is already open.", "info");
        return;
      }

      const parsedArgs = parseJobWorkersArgs(args);
      if (parsedArgs.error) {
        ctx.ui.notify(parsedArgs.error, "error");
        return;
      }

      const repoRoot = getRepoRoot(ctx.cwd);
      const jobs = listJobs(agentDir, repoRoot ? { repoRoot } : undefined);
      const currentJob = readScopedJobState(ctx.cwd);
      const initialJobId = parsedArgs.jobId ?? (currentJob?.id as string | undefined) ?? jobs[0]?.id;

      if (!initialJobId) {
        ctx.ui.notify("No live or historical jobs are available for this repository.", "info");
        return;
      }
      if (!jobs.some((job) => job.id === initialJobId)) {
        ctx.ui.notify(`Job ${initialJobId} is not available in this repository inspector.`, "error");
        return;
      }

      await showWorkerLogDialog(ctx, runtime, {
        agentDir,
        repoRoot,
        initialJobId,
        initialCycleFilter: normalizeCycleFilter(parsedArgs.cycleFilter),
      });
    },
  });

  // ── /job-doctor command ───────────────────────────────────────────────────

  pi.registerCommand("job-doctor", {
    description: "Inspect persisted job state, event logs, locks, proofs, and worktree health.",
    handler: async (args, ctx) => {
      const requestedJobId = args.trim() || undefined;
      const availableModels = ctx.modelRegistry
        .getAvailable()
        .map((model: { provider: string; id: string }) => `${model.provider}/${model.id}`);

      const report = runDoctor({
        agentDir,
        jobId: requestedJobId,
        repoRoot: getRepoRoot(ctx.cwd),
        availableModels,
      });

      const level = report.overallStatus === "CRITICAL"
        ? "error"
        : report.overallStatus === "WARNING"
          ? "warning"
          : "info";

      ctx.ui.notify(formatDoctorReport(report), level);
    },
  });

  // ── /job-cleanup command ──────────────────────────────────────────────────

  pi.registerCommand("job-cleanup", {
    description: "Prune old terminal job artifacts and stale worktrees. Supports --dry-run and --keep-days N.",
    handler: async (args, ctx) => {
      const cleanupArgs = parseJobCleanupArgs(args);
      if (cleanupArgs.error) {
        ctx.ui.notify(cleanupArgs.error, "error");
        return;
      }

      const plan = planCleanup({
        agentDir,
        keepDays: cleanupArgs.keepDays,
      });
      const summary = formatCleanupPlan(plan);

      if (cleanupArgs.dryRun || plan.candidates.length === 0) {
        ctx.ui.notify(summary, plan.candidates.length === 0 ? "info" : "warning");
        return;
      }

      const confirmed = await ctx.ui.confirm(
        "Job Cleanup",
        `${summary}\n\nRemove these exact paths?`,
      );
      if (!confirmed) {
        ctx.ui.notify("Job cleanup cancelled.", "info");
        return;
      }

      const result = executeCleanup(plan);
      ctx.ui.notify(
        `Removed ${result.removedCount} path(s). Reclaimed ${result.reclaimedBytes} bytes.`,
        result.removedCount > 0 ? "success" : "info",
      );
    },
  });

  // ── /job-abandon command ──────────────────────────────────────────────────

  pi.registerCommand("job-abandon", {
    description: "Abandon the current job and clear job state.",
    handler: async (args, ctx) => {
      const state = readScopedJobState(ctx.cwd);
      if (!state) {
        ctx.ui.notify("No active job for this repository.", "info");
        return;
      }

      const confirmed = await ctx.ui.confirm(
        "Abandon Job",
        `Abandon job "${state.description}"? The worktree (if any) will NOT be automatically deleted.`,
      );
      if (!confirmed) return;

      clearScopedJobState(ctx.cwd);
      resetWorkerMonitorState(runtime.workerMonitor, undefined);
      runtime.workerLogsHintShown = false;
      runtime.workerViewerRequestRender?.();
      runtime.mode = "idle";
      runtime.jobSpec = undefined;
      pi.setSessionName("");
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.notify("Job abandoned and state cleared.", "warning");
    },
  });

  // ── SwampCastle write helper (closed over pi) ───────────────────────────

  function sendSwampCastleWrites(
    retroResult: Record<string, unknown>,
    finalState: Record<string, unknown>,
  ): void {
    const jobId = finalState.id as string;
    const processChanges = Array.isArray(retroResult.processChanges)
      ? (retroResult.processChanges as { description: string; rationale: string }[])
      : [];

    if (processChanges.length > 0) {
      const prompt = buildRetroWritePrompt({
        jobId,
        summary: (retroResult.summary as string) ?? "",
        processChanges,
      });
      pi.sendUserMessage(prompt, { deliverAs: "nextTurn" });
    }

    const jesterIssues = Array.isArray(retroResult.jesterPatterns)
      ? (retroResult.jesterPatterns as string[]).map((p) => ({ severity: "minor", critique: p }))
      : [];
    if (jesterIssues.length > 0) {
      pi.sendUserMessage(
        buildJesterFlagsWritePrompt({ jobId, stage: "all", issues: jesterIssues }),
        { deliverAs: "nextTurn" },
      );
    }
  }

  // ── /job-autonomy command ─────────────────────────────────────────────────

  pi.registerCommand("job-autonomy", {
    description: "Show autonomy state and streak toward earned autonomy.",
    handler: async (args, ctx) => {
      const autonomyState = readAutonomyState(agentDir);
      const config = loadConfig(agentDir);
      const required = config.autonomy.cleanRetrosRequired;
      const streak = autonomyState.cleanRetroStreak;
      const suggestion = shouldSuggestAutonomy(autonomyState, config.autonomy);

      const lines = [
        `Clean retro streak: ${streak} / ${required} required`,
        suggestion
          ? "✓ Streak reached threshold — consider switching a gate to auto-accept."
          : `${required - streak} more clean retro(s) before autonomy can be suggested.`,
      ];
      ctx.ui.notify(lines.join("\n"), suggestion ? "success" : "info");
    },
  });

  // ── Retro runner (local, has access to sendSwampCastleWrites) ────────────────────────

  async function runRetroLocal(
    finalState: Record<string, unknown>,
    ctx: ExtensionContext,
    signal?: AbortSignal,
  ): Promise<void> {
    const config_ = loadConfig(agentDir);
    const gateMode = config_.gates.retroReview.mode;

    const jobSummary = buildJobSummary(finalState);
    const previousChanges = "";

    const retroTaskId = `planner-retro-cycle-${finalState.cycleIndex ?? 1}`;
    recordWorkerEvent({
      type: "worker-started",
      jobId: finalState.id,
      cycleIndex: finalState.cycleIndex ?? 1,
      taskId: retroTaskId,
      title: `Planner — retrospective (cycle ${finalState.cycleIndex ?? 1})`,
    });

    let retroOutput: string;
    try {
      retroOutput = await spawnAgent({
        modelId: (finalState.pool as Record<string, string>).planner,
        thinkingLevel: getRoleThinkingLevel('planner'),
        systemPrompt: retroPrompt({ jobSummary, previousChanges }),
        userPrompt: "Facilitate the retrospective.",
        signal,
        onLogLine: (line) => recordWorkerEvent({
          type: "worker-log",
          jobId: finalState.id,
          cycleIndex: finalState.cycleIndex ?? 1,
          taskId: retroTaskId,
          title: `Planner — retrospective (cycle ${finalState.cycleIndex ?? 1})`,
          text: `${line}\n`,
        }),
      });
      recordWorkerEvent({
        type: "worker-finished",
        jobId: finalState.id,
        cycleIndex: finalState.cycleIndex ?? 1,
        taskId: retroTaskId,
        status: "success",
      });
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      recordWorkerEvent({
        type: "worker-log",
        jobId: finalState.id,
        cycleIndex: finalState.cycleIndex ?? 1,
        taskId: retroTaskId,
        title: `Planner — retrospective (cycle ${finalState.cycleIndex ?? 1})`,
        text: `Agent error: ${errorMessage}\n`,
      });
      recordWorkerEvent({
        type: "worker-finished",
        jobId: finalState.id,
        cycleIndex: finalState.cycleIndex ?? 1,
        taskId: retroTaskId,
        status: "failed",
      });
      throw err;
    }

    let retroResult: Record<string, unknown>;
    try {
      retroResult = extractJson(retroOutput) as Record<string, unknown>;
    } catch {
      retroResult = { verdict: "clean", processChanges: [], summary: retroOutput };
    }

    const currentAutonomyState = readAutonomyState(agentDir);
    const hasChanges =
      retroResult.verdict === "changes-proposed" &&
      Array.isArray(retroResult.processChanges) &&
      retroResult.processChanges.length > 0;
    const previewCleanRetroStreak = hasChanges
      ? 0
      : currentAutonomyState.cleanRetroStreak + 1;

    if (gateMode === "compulsory") {
      const approved = await showScrollableGateDialog(
        ctx.ui,
        buildRetroReviewDialogSpec({
          summary: (retroResult.summary as string) ?? retroOutput,
          processChanges: Array.isArray(retroResult.processChanges)
            ? (retroResult.processChanges as { description: string }[]).map((change) => change.description)
            : [],
          cleanRetroStreak: previewCleanRetroStreak,
          cleanRetrosRequired: config_.autonomy.cleanRetrosRequired,
        }),
      );
      if (!approved) {
        throw new GateDeniedError("retro-review");
      }
    } else {
      ctx.ui.notify(`Retro summary: ${retroResult.summary ?? "clean"}`, "info");
    }

    const updatedAutonomyState = hasChanges
      ? recordRetroWithChanges(currentAutonomyState)
      : recordCleanRetro(currentAutonomyState);
    writeAutonomyState(agentDir, updatedAutonomyState);

    if (shouldSuggestAutonomy(updatedAutonomyState, config_.autonomy)) {
      ctx.ui.notify(
        `Clean retro streak reached ${updatedAutonomyState.cleanRetroStreak}. Consider switching a gate to auto-accept via /job-pool.`,
        "success",
      );
    }

    if (finalState.id) {
      sendSwampCastleWrites(retroResult, finalState);
    }
  }
}

// ── Config helpers ────────────────────────────────────────────────────────────

function loadConfig(agentDir: string) {
  const path = getConfigPath(agentDir);
  try {
    if (!existsSync(path)) return structuredClone(DEFAULT_JOB_PIPELINE_CONFIG);
    const raw = JSON.parse(readFileSync(path, "utf-8")) as unknown;
    const result = normalizeJobPipelineConfig(raw);
    for (const w of result.warnings ?? []) {
      console.warn(`[job-pipeline] ${w}`);
    }
    return result.value;
  } catch {
    return structuredClone(DEFAULT_JOB_PIPELINE_CONFIG);
  }
}

function saveConfig(agentDir: string, config: unknown): void {
  const path = getConfigPath(agentDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
}

function parseJobCleanupArgs(rawArgs: string): { dryRun: boolean; keepDays: number; error?: string } {
  const tokens = rawArgs.trim().length > 0 ? rawArgs.trim().split(/\s+/) : [];
  let dryRun = false;
  let keepDays = 7;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--keep-days") {
      const value = tokens[index + 1];
      if (!value) {
        return { dryRun, keepDays, error: "Missing value for --keep-days." };
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return { dryRun, keepDays, error: `Invalid --keep-days value: ${value}` };
      }
      keepDays = parsed;
      index += 1;
      continue;
    }
    return { dryRun, keepDays, error: `Unknown /job-cleanup argument: ${token}` };
  }

  return { dryRun, keepDays };
}

function buildJobSummary(state: Record<string, unknown>): string {
  const lines = [
    `Goal: ${state.description ?? "unknown"}`,
    `Total cycles: ${state.cycleIndex ?? 1}`,
    `Re-plans triggered: ${state.replanCount ?? 0}`,
    `Tasks: ${(state.taskGraph as { tasks?: unknown[] } | undefined)?.tasks?.length ?? 0}`,
  ];
  return lines.join("\n");
}

function buildInterviewStartConfirmationText(spec: Record<string, unknown> | undefined): string {
  const constraints = Array.isArray(spec?.constraints) && spec.constraints.length > 0
    ? (spec.constraints as string[]).map((constraint) => `- ${constraint}`).join("\n")
    : "- None recorded.";
  const outOfScope = Array.isArray(spec?.outOfScope) && spec.outOfScope.length > 0
    ? (spec.outOfScope as string[]).map((item) => `- ${item}`).join("\n")
    : "- None recorded.";

  return [
    `Goal: ${String(spec?.goal ?? "(not provided)")}`,
    "",
    "Context:",
    String(spec?.context ?? "(not provided)"),
    "",
    "Constraints:",
    constraints,
    "",
    "Out of scope:",
    outOfScope,
    "",
    "Start the pipeline now?",
  ].join("\n");
}

async function showScrollableGateDialog(
  ui: ExtensionContext["ui"],
  spec: ScrollableGateDialogSpec,
): Promise<boolean> {
  return ui.custom<boolean>(
    (tui, theme, keybindings, done) => {
      const state = new ScrollableApprovalDialogState({
        bodyText: spec.body,
        question: spec.question,
      });
      let bodyWidth = 72;

      const border = (text: string) => theme.fg("border", text);
      const padLine = (text: string, width: number) => {
        const truncated = truncateToWidth(text, width, "");
        return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
      };
      const row = (text: string, width: number) => border("│") + padLine(text, width) + border("│");
      const separator = (width: number) => border(`├${"─".repeat(width)}┤`);
      const matchesAny = (data: string, ids: string[]) => ids.some((id) => keybindings.matches(data, id));

      return {
        render: (width: number) => {
          const innerWidth = Math.max(1, width - 2);
          bodyWidth = Math.max(1, innerWidth - 1);

          const viewport = state.getViewport(bodyWidth);
          const visibleTo = Math.min(
            viewport.totalLineCount,
            viewport.scrollOffset + viewport.visibleLineCount,
          );
          const scrollLabel = viewport.maxScrollOffset > 0
            ? ` Scroll ${viewport.scrollOffset + 1}-${visibleTo} of ${viewport.totalLineCount}`
            : ` Full content visible (${viewport.totalLineCount} lines)`;
          const questionLines = wrapPlainText(spec.question, bodyWidth);
          const selectedApprove = state.getSelectedChoice() === "approve";
          const approveChoice = selectedApprove
            ? theme.fg("accent", `[${spec.approveLabel}]`)
            : spec.approveLabel;
          const denyChoice = selectedApprove
            ? spec.denyLabel
            : theme.fg("accent", `[${spec.denyLabel}]`);
          const choiceLine = `${approveChoice} ${theme.fg("dim", "/")} ${denyChoice}`;
          const helpLine = `↑↓ scroll • PgUp/PgDn page • ←→ choose • Enter confirm • Esc ${spec.denyLabel}`;

          const lines = [
            border(`╭${"─".repeat(innerWidth)}╮`),
            row(` ${theme.fg("accent", theme.bold(spec.title))}`, innerWidth),
            row(` ${theme.fg("dim", scrollLabel)}`, innerWidth),
            separator(innerWidth),
            ...viewport.lines.map((line) => row(` ${line}`, innerWidth)),
          ];

          for (let index = viewport.lines.length; index < viewport.visibleLineCount; index += 1) {
            lines.push(row("", innerWidth));
          }

          lines.push(separator(innerWidth));
          for (const line of questionLines) {
            lines.push(row(` ${theme.bold(line)}`, innerWidth));
          }
          lines.push(row(` ${choiceLine}`, innerWidth));
          lines.push(row(` ${theme.fg("dim", helpLine)}`, innerWidth));
          lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
          return lines;
        },
        invalidate: () => state.invalidate(),
        handleInput: (data: string) => {
          if (matchesAny(data, ["tui.select.cancel", "app.interrupt"])) {
            done(false);
            return;
          }
          if (matchesAny(data, ["tui.select.confirm", "tui.input.submit"])) {
            done(state.confirm());
            return;
          }

          let changed = false;
          if (matchesAny(data, ["tui.select.up", "tui.editor.cursorUp"])) {
            state.scrollUp(bodyWidth);
            changed = true;
          } else if (matchesAny(data, ["tui.select.down", "tui.editor.cursorDown"])) {
            state.scrollDown(bodyWidth);
            changed = true;
          } else if (matchesAny(data, ["tui.select.pageUp", "tui.editor.pageUp"])) {
            state.pageUp(bodyWidth);
            changed = true;
          } else if (matchesAny(data, ["tui.select.pageDown", "tui.editor.pageDown"])) {
            state.pageDown(bodyWidth);
            changed = true;
          } else if (keybindings.matches(data, "tui.editor.cursorLeft")) {
            state.selectApprove();
            changed = true;
          } else if (keybindings.matches(data, "tui.editor.cursorRight")) {
            state.selectDeny();
            changed = true;
          } else if (keybindings.matches(data, "tui.input.tab")) {
            state.toggleChoice();
            changed = true;
          }

          if (changed) {
            tui.requestRender();
          }
        },
      };
    },
    {
      overlay: true,
      overlayOptions: {
        anchor: "center",
        width: "84%",
        minWidth: 96,
        maxHeight: "85%",
        margin: 1,
      },
    },
  );
}

async function showWorkerLogDialog(
  ctx: ExtensionContext,
  runtime: RuntimeState,
  options: {
    agentDir: string,
    repoRoot?: string,
    initialJobId: string,
    initialCycleFilter: "all" | number,
  },
): Promise<void> {
  const JOB_VIEWER_BODY_ROWS = 14;
  const WORKER_VIEWER_BODY_ROWS = 24;

  try {
    await ctx.ui.custom<void>(
      (tui, theme, keybindings, done) => {
        let selectedJobId = options.initialJobId;
        let selectedWorkerKey: string | undefined;
        let cycleFilter: "all" | number = options.initialCycleFilter;
        let focus: "jobs" | "workers" | "log" = "workers";
        let jobScrollOffset = 0;
        let workerScrollOffset = 0;
        let logScrollOffset = 0;
        let lastMeasuredLogWidth = 60;

        runtime.workerViewerRequestRender = () => tui.requestRender();

        const border = (text: string) => theme.fg("border", text);
        const padLine = (text: string, width: number) => {
          const truncated = truncateToWidth(text, width, "");
          return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
        };
        const formatStatus = (status: WorkerLogEntry["status"]) => {
          switch (status) {
            case "running":
              return theme.fg("accent", "● running");
            case "success":
              return theme.fg("success", "✓ success");
            case "failed":
              return theme.fg("error", "✗ failed");
            case "queued":
              return theme.fg("warning", "○ queued");
            default:
              return theme.fg("dim", "○ pending");
          }
        };
        const getJobsForRepo = () => listJobs(options.agentDir, options.repoRoot ? { repoRoot: options.repoRoot } : undefined);
        const ensureSelectedJob = () => {
          const jobs = getJobsForRepo();
          if (jobs.length === 0) {
            selectedJobId = "";
            return { jobs, selectedJob: undefined };
          }
          if (!jobs.some((job) => job.id === selectedJobId)) {
            selectedJobId = jobs[0]?.id ?? "";
            selectedWorkerKey = undefined;
            workerScrollOffset = 0;
            logScrollOffset = 0;
          }
          return {
            jobs,
            selectedJob: jobs.find((job) => job.id === selectedJobId),
          };
        };
        const getSelectedJobSnapshot = () => {
          const { selectedJob } = ensureSelectedJob();
          if (!selectedJob) {
            return null;
          }
          return loadJobSnapshot(options.agentDir, selectedJob.id) as Record<string, unknown> | null;
        };
        const buildMonitorSnapshot = () => {
          const jobState = getSelectedJobSnapshot();
          if (!jobState) {
            return {
              source: "persisted" as const,
              availableCycles: [] as number[],
              selectedCycle: "all" as const,
              workers: [] as WorkerLogEntry[],
            };
          }

          const isLiveJob = runtime.workerMonitor.jobId === jobState.id && runtime.workerMonitor.workers.length > 0;
          if (isLiveJob) {
            const availableCycles = [...new Set(runtime.workerMonitor.workers.map((worker) => worker.cycleIndex))]
              .sort((left, right) => left - right);
            const selectedCycle = normalizeInspectorCycle(cycleFilter, availableCycles);
            const workers = selectedCycle === "all"
              ? runtime.workerMonitor.workers
              : runtime.workerMonitor.workers.filter((worker) => worker.cycleIndex === selectedCycle);
            return {
              source: "live" as const,
              availableCycles,
              selectedCycle,
              workers,
            };
          }

          const persisted = buildPersistedWorkerMonitorState({
            agentDir: options.agentDir,
            jobState,
            cycleFilter,
          }) as WorkerMonitorState & {
            availableCycles?: number[],
            selectedCycle?: "all" | number,
          };
          return {
            source: "persisted" as const,
            availableCycles: persisted.availableCycles ?? [],
            selectedCycle: persisted.selectedCycle ?? "all",
            workers: persisted.workers as WorkerLogEntry[],
          };
        };
        const ensureSelectedWorker = () => {
          const monitor = buildMonitorSnapshot();
          const workers = monitor.workers;
          if (workers.length === 0) {
            selectedWorkerKey = undefined;
            workerScrollOffset = 0;
            logScrollOffset = 0;
            return { monitor, selectedWorker: undefined };
          }

          if (!selectedWorkerKey || !workers.some((worker) => worker.key === selectedWorkerKey)) {
            const runningWorker = [...workers].reverse().find((worker) => worker.status === "running");
            selectedWorkerKey = (runningWorker ?? workers[workers.length - 1])?.key;
            logScrollOffset = 0;
          }

          return {
            monitor,
            selectedWorker: workers.find((worker) => worker.key === selectedWorkerKey),
          };
        };
        const changeSelectedJob = (delta: number) => {
          const { jobs } = ensureSelectedJob();
          if (jobs.length === 0) {
            return false;
          }
          const currentIndex = jobs.findIndex((job) => job.id === selectedJobId);
          const safeIndex = currentIndex >= 0 ? currentIndex : 0;
          const nextIndex = Math.max(0, Math.min(jobs.length - 1, safeIndex + delta));
          if (nextIndex === safeIndex) {
            return false;
          }
          selectedJobId = jobs[nextIndex]?.id ?? selectedJobId;
          selectedWorkerKey = undefined;
          workerScrollOffset = 0;
          logScrollOffset = 0;
          jobScrollOffset = clampScrollOffset(nextIndex, jobScrollOffset, JOB_VIEWER_BODY_ROWS);
          return true;
        };
        const jumpSelectedJob = (target: "first" | "last") => {
          const { jobs } = ensureSelectedJob();
          if (jobs.length === 0) {
            return false;
          }
          const nextIndex = target === "first" ? 0 : jobs.length - 1;
          selectedJobId = jobs[nextIndex]?.id ?? selectedJobId;
          selectedWorkerKey = undefined;
          workerScrollOffset = 0;
          logScrollOffset = 0;
          jobScrollOffset = clampScrollOffset(nextIndex, jobScrollOffset, JOB_VIEWER_BODY_ROWS);
          return true;
        };
        const changeSelectedWorker = (delta: number) => {
          const { monitor } = ensureSelectedWorker();
          const workers = monitor.workers;
          if (workers.length === 0) {
            return false;
          }
          const currentIndex = workers.findIndex((worker) => worker.key === selectedWorkerKey);
          const safeIndex = currentIndex >= 0 ? currentIndex : workers.length - 1;
          const nextIndex = Math.max(0, Math.min(workers.length - 1, safeIndex + delta));
          if (nextIndex === safeIndex) {
            return false;
          }
          selectedWorkerKey = workers[nextIndex]?.key;
          logScrollOffset = 0;
          workerScrollOffset = clampScrollOffset(nextIndex, workerScrollOffset, WORKER_VIEWER_BODY_ROWS);
          return true;
        };
        const jumpSelectedWorker = (target: "first" | "last") => {
          const { monitor } = ensureSelectedWorker();
          const workers = monitor.workers;
          if (workers.length === 0) {
            return false;
          }
          const nextIndex = target === "first" ? 0 : workers.length - 1;
          selectedWorkerKey = workers[nextIndex]?.key;
          logScrollOffset = 0;
          workerScrollOffset = clampScrollOffset(nextIndex, workerScrollOffset, WORKER_VIEWER_BODY_ROWS);
          return true;
        };
        const changeCycle = (delta: number) => {
          const { availableCycles } = buildMonitorSnapshot();
          const cycleOptions: Array<"all" | number> = ["all", ...availableCycles];
          if (cycleOptions.length <= 1) {
            return false;
          }
          const currentIndex = cycleOptions.findIndex((item) => item === cycleFilter);
          const safeIndex = currentIndex >= 0 ? currentIndex : 0;
          const nextIndex = Math.max(0, Math.min(cycleOptions.length - 1, safeIndex + delta));
          if (nextIndex === safeIndex) {
            return false;
          }
          cycleFilter = cycleOptions[nextIndex] ?? cycleFilter;
          selectedWorkerKey = undefined;
          workerScrollOffset = 0;
          logScrollOffset = 0;
          return true;
        };
        const changeLogScroll = (delta: number) => {
          const { selectedWorker } = ensureSelectedWorker();
          const wrappedLogLines = wrapWorkerLogLines(
            selectedWorker ? getWorkerLogLines(selectedWorker) : buildEmptyWorkerLog(runtime.mode),
            lastMeasuredLogWidth,
          );
          const maxOffset = Math.max(0, wrappedLogLines.length - WORKER_VIEWER_BODY_ROWS);
          const nextOffset = Math.max(0, Math.min(maxOffset, logScrollOffset + delta));
          if (nextOffset === logScrollOffset) {
            return false;
          }
          logScrollOffset = nextOffset;
          return true;
        };
        const jumpLogScroll = (target: "top" | "bottom") => {
          const { selectedWorker } = ensureSelectedWorker();
          const wrappedLogLines = wrapWorkerLogLines(
            selectedWorker ? getWorkerLogLines(selectedWorker) : buildEmptyWorkerLog(runtime.mode),
            lastMeasuredLogWidth,
          );
          const maxOffset = Math.max(0, wrappedLogLines.length - WORKER_VIEWER_BODY_ROWS);
          const nextOffset = target === "top" ? 0 : maxOffset;
          if (nextOffset === logScrollOffset) {
            return false;
          }
          logScrollOffset = nextOffset;
          return true;
        };
        const openSelectedInEditor = () => {
          const { selectedWorker } = ensureSelectedWorker();
          if (!selectedWorker) {
            ctx.ui.notify("No inspector item is selected.", "warning");
            return false;
          }

          ctx.ui.setEditorText(readWorkerEntryContent(selectedWorker));
          ctx.ui.notify(`Loaded ${selectedWorker.title} into the editor.`, "success");
          done(undefined);
          return true;
        };
        const openSelectedInBrowser = () => {
          const { selectedWorker } = ensureSelectedWorker();
          const browserPath = selectedWorker?.browserPath
            ?? (selectedWorker?.sourceType === "html" ? selectedWorker.sourcePath : undefined);
          if (!browserPath) {
            ctx.ui.notify("The selected inspector item does not expose a browser-openable path.", "warning");
            return false;
          }

          const openCommand = buildBrowserOpenCommand(browserPath);
          if (!openCommand) {
            ctx.ui.notify("Could not determine how to open the selected path in a browser.", "error");
            return false;
          }

          try {
            const child = spawn(openCommand.command, openCommand.args, {
              detached: true,
              stdio: "ignore",
            });
            child.on("error", (error) => {
              ctx.ui.notify(`Failed to open browser path: ${error.message}`, "error");
            });
            child.unref();
            ctx.ui.notify(`Opened ${browserPath} in the browser.`, "success");
            return true;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            ctx.ui.notify(`Failed to open browser path: ${message}`, "error");
            return false;
          }
        };

        return {
          render: (width: number) => {
            const innerWidth = Math.max(1, width - 2);
            const jobsWidth = Math.max(24, Math.min(34, Math.floor(innerWidth * 0.22)));
            const workersWidth = Math.max(30, Math.min(44, Math.floor(innerWidth * 0.28)));
            const logWidth = Math.max(24, innerWidth - jobsWidth - workersWidth - 2);
            lastMeasuredLogWidth = logWidth;

            const { jobs, selectedJob } = ensureSelectedJob();
            const { monitor, selectedWorker } = ensureSelectedWorker();
            const selectedJobIndex = selectedJob
              ? Math.max(0, jobs.findIndex((job) => job.id === selectedJob.id))
              : 0;
            jobScrollOffset = clampScrollOffset(selectedJobIndex, jobScrollOffset, JOB_VIEWER_BODY_ROWS);
            const selectedWorkerIndex = selectedWorker
              ? Math.max(0, monitor.workers.findIndex((worker) => worker.key === selectedWorker.key))
              : 0;
            workerScrollOffset = clampScrollOffset(selectedWorkerIndex, workerScrollOffset, WORKER_VIEWER_BODY_ROWS);

            const jobLines = jobs
              .slice(jobScrollOffset, jobScrollOffset + JOB_VIEWER_BODY_ROWS)
              .map((job) => {
                const prefix = job.id === selectedJobId ? theme.fg("accent", "▶ ") : "  ";
                const title = `${job.id} — ${job.description || job.step || "(unnamed)"}`;
                return `${prefix}${job.id === selectedJobId ? theme.fg("accent", truncateToWidth(title, jobsWidth - 2, "")) : truncateToWidth(title, jobsWidth - 2, "")}`;
              });
            const workerLines = monitor.workers
              .slice(workerScrollOffset, workerScrollOffset + WORKER_VIEWER_BODY_ROWS)
              .map((worker) => {
                const prefix = worker.key === selectedWorkerKey ? theme.fg("accent", "▶ ") : "  ";
                const title = formatMonitorListEntry(worker);
                return `${prefix}${worker.key === selectedWorkerKey ? theme.fg("accent", truncateToWidth(title, workersWidth - 2, "")) : truncateToWidth(title, workersWidth - 2, "")}`;
              });
            const rawLogLines = selectedWorker
              ? getWorkerLogLines(selectedWorker)
              : buildEmptyWorkerLog(runtime.mode);
            const wrappedLogLines = wrapWorkerLogLines(rawLogLines, logWidth);
            const maxLogOffset = Math.max(0, wrappedLogLines.length - WORKER_VIEWER_BODY_ROWS);
            logScrollOffset = Math.min(logScrollOffset, maxLogOffset);
            const visibleLogLines = wrappedLogLines.slice(logScrollOffset, logScrollOffset + WORKER_VIEWER_BODY_ROWS);

            const cycleLabel = formatCycleFilterLabel(monitor.selectedCycle);
            const titleLine = theme.fg("accent", theme.bold("Job Inspector"));
            const subtitleLine = selectedJob
              ? `${selectedJob.id} • ${selectedJob.description || selectedJob.step || "(unnamed)"} • cycle ${cycleLabel} • ${monitor.source}`
              : "No job selected.";
            const jobsHeader = focus === "jobs" ? theme.fg("accent", theme.bold("Jobs")) : theme.bold("Jobs");
            const workersHeader = focus === "workers" ? theme.fg("accent", theme.bold("Entries")) : theme.bold("Entries");
            const logHeader = focus === "log"
              ? theme.fg("accent", theme.bold(selectedWorker ? `Log — ${selectedWorker.title}` : "Log"))
              : theme.bold(selectedWorker ? `Log — ${selectedWorker.title}` : "Log");
            const jobsInfo = jobs.length > 0
              ? `${Math.min(jobs.length, jobScrollOffset + JOB_VIEWER_BODY_ROWS)}/${jobs.length} shown`
              : "No jobs";
            const workersInfo = `${monitor.workers.length} item${monitor.workers.length === 1 ? "" : "s"} • cycles: ${monitor.availableCycles.length > 0 ? monitor.availableCycles.join(", ") : "none"}`;
            const logInfo = selectedWorker
              ? `${selectedWorker.title} • ${formatStatus(selectedWorker.status)} • ${wrappedLogLines.length} lines`
              : theme.fg("dim", "No inspector item selected.");
            const helpLine = theme.fg(
              "dim",
              "Tab switch pane • ↑↓ move • PgUp/PgDn page • Home/End jump • [ ] cycle • e open in editor • b open in browser • Esc close",
            );

            const lines = [
              border(`╭${"─".repeat(innerWidth)}╮`),
              border("│") + padLine(` ${titleLine}`, innerWidth) + border("│"),
              border("│") + padLine(` ${theme.fg("dim", subtitleLine)}`, innerWidth) + border("│"),
              border(`├${"─".repeat(innerWidth)}┤`),
              border("│") + padLine(` ${jobsHeader}`, jobsWidth) + border("│") + padLine(` ${workersHeader}`, workersWidth) + border("│") + padLine(` ${logHeader}`, logWidth) + border("│"),
              border("│") + padLine(` ${theme.fg("dim", jobsInfo)}`, jobsWidth) + border("│") + padLine(` ${theme.fg("dim", workersInfo)}`, workersWidth) + border("│") + padLine(` ${logInfo}`, logWidth) + border("│"),
              border(`├${"─".repeat(innerWidth)}┤`),
            ];

            for (let index = 0; index < WORKER_VIEWER_BODY_ROWS; index += 1) {
              lines.push(
                border("│")
                  + padLine(` ${jobLines[index] ?? ""}`, jobsWidth)
                  + border("│")
                  + padLine(` ${workerLines[index] ?? ""}`, workersWidth)
                  + border("│")
                  + padLine(` ${visibleLogLines[index] ?? ""}`, logWidth)
                  + border("│"),
              );
            }

            lines.push(border(`├${"─".repeat(innerWidth)}┤`));
            lines.push(border("│") + padLine(` ${helpLine}`, innerWidth) + border("│"));
            lines.push(border(`╰${"─".repeat(innerWidth)}╯`));
            return lines;
          },
          invalidate: () => {},
          handleInput: (data: string) => {
            let changed = false;

            if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "app.interrupt")) {
              done(undefined);
              return;
            }
            if (data === "e" || data === "E") {
              openSelectedInEditor();
              return;
            }
            if (data === "b" || data === "B") {
              openSelectedInBrowser();
              return;
            }
            if (data === "[") {
              changed = changeCycle(-1);
            } else if (data === "]") {
              changed = changeCycle(1);
            } else if (keybindings.matches(data, "tui.input.tab")) {
              focus = focus === "jobs" ? "workers" : focus === "workers" ? "log" : "jobs";
              changed = true;
            } else if (focus === "jobs") {
              if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.editor.cursorUp")) {
                changed = changeSelectedJob(-1);
              } else if (keybindings.matches(data, "tui.select.down") || keybindings.matches(data, "tui.editor.cursorDown")) {
                changed = changeSelectedJob(1);
              } else if (keybindings.matches(data, "tui.select.pageUp") || keybindings.matches(data, "tui.editor.pageUp")) {
                changed = changeSelectedJob(-JOB_VIEWER_BODY_ROWS);
              } else if (keybindings.matches(data, "tui.select.pageDown") || keybindings.matches(data, "tui.editor.pageDown")) {
                changed = changeSelectedJob(JOB_VIEWER_BODY_ROWS);
              } else if (keybindings.matches(data, "tui.editor.cursorLineStart")) {
                changed = jumpSelectedJob("first");
              } else if (keybindings.matches(data, "tui.editor.cursorLineEnd")) {
                changed = jumpSelectedJob("last");
              }
            } else if (focus === "workers") {
              if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.editor.cursorUp")) {
                changed = changeSelectedWorker(-1);
              } else if (keybindings.matches(data, "tui.select.down") || keybindings.matches(data, "tui.editor.cursorDown")) {
                changed = changeSelectedWorker(1);
              } else if (keybindings.matches(data, "tui.select.pageUp") || keybindings.matches(data, "tui.editor.pageUp")) {
                changed = changeSelectedWorker(-WORKER_VIEWER_BODY_ROWS);
              } else if (keybindings.matches(data, "tui.select.pageDown") || keybindings.matches(data, "tui.editor.pageDown")) {
                changed = changeSelectedWorker(WORKER_VIEWER_BODY_ROWS);
              } else if (keybindings.matches(data, "tui.editor.cursorLineStart")) {
                changed = jumpSelectedWorker("first");
              } else if (keybindings.matches(data, "tui.editor.cursorLineEnd")) {
                changed = jumpSelectedWorker("last");
              }
            } else if (focus === "log") {
              if (keybindings.matches(data, "tui.select.up") || keybindings.matches(data, "tui.editor.cursorUp")) {
                changed = changeLogScroll(-1);
              } else if (keybindings.matches(data, "tui.select.down") || keybindings.matches(data, "tui.editor.cursorDown")) {
                changed = changeLogScroll(1);
              } else if (keybindings.matches(data, "tui.select.pageUp") || keybindings.matches(data, "tui.editor.pageUp")) {
                changed = changeLogScroll(-WORKER_VIEWER_BODY_ROWS);
              } else if (keybindings.matches(data, "tui.select.pageDown") || keybindings.matches(data, "tui.editor.pageDown")) {
                changed = changeLogScroll(WORKER_VIEWER_BODY_ROWS);
              } else if (keybindings.matches(data, "tui.editor.cursorLineStart")) {
                changed = jumpLogScroll("top");
              } else if (keybindings.matches(data, "tui.editor.cursorLineEnd")) {
                changed = jumpLogScroll("bottom");
              }
            }

            if (changed) {
              tui.requestRender();
            }
          },
        };
      },
    );
  } finally {
    runtime.workerViewerRequestRender = undefined;
  }
}

function normalizeInspectorCycle(cycleFilter: "all" | number, availableCycles: number[]): "all" | number {
  if (cycleFilter === "all" || availableCycles.length === 0) {
    return "all";
  }

  return availableCycles.includes(cycleFilter)
    ? cycleFilter
    : (availableCycles[availableCycles.length - 1] ?? "all");
}

function readWorkerEntryContent(worker: WorkerLogEntry): string {
  if (worker.sourcePath && existsSync(worker.sourcePath)) {
    try {
      return readFileSync(worker.sourcePath, "utf8");
    } catch {
      // Fall back to the rendered log lines below.
    }
  }

  return getWorkerLogLines(worker).join("\n");
}

function formatCycleFilterLabel(cycleFilter: "all" | number): string {
  return cycleFilter === "all" ? "all" : String(cycleFilter);
}

function clampScrollOffset(selectedIndex: number, currentOffset: number, visibleCount: number): number {
  if (selectedIndex < currentOffset) {
    return selectedIndex;
  }
  if (selectedIndex >= currentOffset + visibleCount) {
    return selectedIndex - visibleCount + 1;
  }
  return currentOffset;
}

function buildEmptyWorkerLog(mode: JobMode): string[] {
  return mode === "running"
    ? ["Waiting for agent logs…", "Leave this window open; it updates live."]
    : ["No agent logs recorded."];
}

function formatMonitorListEntry(worker: WorkerLogEntry): string {
  if (worker.taskId.startsWith("task-")) {
    return `C${worker.cycleIndex} ${worker.taskId} — ${worker.title}`;
  }
  return `C${worker.cycleIndex} ${worker.title}`;
}

