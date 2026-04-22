import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir, DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

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
import { spawnAgent, extractJson } from "./lib/agents.mjs";

const STATUS_KEY = "job-pipeline";

type JobMode = "idle" | "interview" | "pipeline-ready" | "running" | "retro";

type RuntimeState = {
  mode: JobMode;
  capturedCtx?: ExtensionContext;
  jobSpec?: Record<string, unknown>;
};

export default function jobPipelineExtension(pi: ExtensionAPI) {
  const agentDir = getAgentDir();
  const runtime: RuntimeState = { mode: "idle" };

  // ── Capture ctx for use in background async pipeline ──────────────────────

  function captureCtx(ctx: ExtensionContext): void {
    runtime.capturedCtx = ctx;
  }

  pi.on("session_start", (_, ctx) => captureCtx(ctx));
  pi.on("before_agent_start", (_, ctx) => captureCtx(ctx));
  pi.on("agent_end", (_, ctx) => captureCtx(ctx));

  // ── Interview system prompt injection ─────────────────────────────────────

  pi.on("before_agent_start", async (event, _ctx) => {
    if (runtime.mode === "interview") {
      const jobState = readJobState(agentDir) as Record<string, unknown> | null;
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
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const spec = params;
      runtime.jobSpec = spec;
      runtime.mode = "pipeline-ready";

      const jobState = readJobState(agentDir) as Record<string, unknown> | null;
      if (jobState) {
        writeJobState(agentDir, {
          ...jobState,
          spec,
          step: "pipeline-ready",
          updatedAt: Date.now(),
        });
      }

      ctx.ui.notify("Interview complete. Spec captured.", "success");
      ctx.ui.setStatus(STATUS_KEY, "pipeline ready");

      // Trigger the orchestrator turn
      pi.sendUserMessage(
        "Interview complete. Please call job_run_pipeline to start execution.",
        { deliverAs: "followUp" },
      );

      return {
        content: [{ type: "text", text: "Interview spec captured successfully. Starting pipeline..." }],
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
      const jobState = readJobState(agentDir) as Record<string, unknown> | null;
      if (!jobState) {
        return {
          content: [{ type: "text", text: "No active job state found. Start a job with /job first." }],
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
          state = { ...state, pool };
          writeJobState(agentDir, state);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.ui.notify(`Pool draw failed: ${msg}`, "error");
          return { content: [{ type: "text", text: `Pool draw failed: ${msg}` }], isError: true };
        }
      }

      runtime.mode = "running";
      ctx.ui.setStatus(STATUS_KEY, "running");

      const steps: string[] = [];
      try {
        const finalState = await runPipeline({
          jobState: state,
          agentDir,
          config,
          ui: ctx.ui,
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
        const msg = err instanceof Error ? err.message : String(err);
        ctx.ui.setStatus(STATUS_KEY, "error");
        return { content: [{ type: "text", text: `Pipeline error: ${msg}` }], isError: true };
      }
    },
  });

  // ── /job command ──────────────────────────────────────────────────────────

  pi.registerCommand("job", {
    description:
      "Start a new job or resume an interrupted one. Usage: /job [description]",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const existing = readJobState(agentDir) as Record<string, unknown> | null;

      // Offer resume if there's an active job
      if (existing && existing.step && existing.step !== "done") {
        const resume = await ctx.ui.confirm(
          "Resume Job",
          `Found interrupted job: "${existing.description}"\nStep: ${existing.step}\n\nResume it?`,
        );
        if (resume) {
          const step = existing.step as string;
          if (step === "interview") {
            runtime.mode = "interview";
            runtime.jobSpec = existing.spec as Record<string, unknown>;
            pi.sendUserMessage("We were in the middle of a planning interview. Please continue where we left off.");
            ctx.ui.setStatus(STATUS_KEY, "interview");
            return;
          }
          // Pipeline steps
          runtime.mode = "pipeline-ready";
          runtime.jobSpec = existing.spec as Record<string, unknown>;
          pi.sendUserMessage("Resuming the pipeline from the last checkpoint.", { deliverAs: "followUp" });
          ctx.ui.setStatus(STATUS_KEY, "resuming");
          return;
        }
        // Abandon existing job
        clearJobState(agentDir);
      }

      // Start new job
      const description = args.trim() || "";
      const jobId = `job-${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
      const initialState = {
        id: jobId,
        description,
        step: "interview",
        createdAt: Date.now(),
        updatedAt: Date.now(),
        replanCount: 0,
        cycleIndex: 1,
        jesterFlags: [],
        tokenCosts: {},
      };
      writeJobState(agentDir, initialState);
      pi.setSessionName(`job: ${description || jobId}`);

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
    description: "Configure model pools for each pipeline role.",
    handler: async (args, ctx) => {
      await ctx.waitForIdle();

      const config = loadConfig(agentDir);
      const available = ctx.modelRegistry
        .getAvailable()
        .map((m: { provider: string; id: string; name: string }) => ({
          fullId: `${m.provider}/${m.id}`,
          name: m.name,
          provider: m.provider,
        }));

      if (available.length === 0) {
        ctx.ui.notify("No models available. Log in to a provider first.", "warning");
        return;
      }

      const roles = ["scout", "planner", "jester", "task-writer", "worker", "reviewer"] as const;
      const roleLabels: Record<string, string> = {
        scout: "Scout — cheap, read-only recon",
        planner: "Planner — expensive, drives planning loop",
        jester: "Jester — adversarial critic (must differ from planner)",
        "task-writer": "Task Writer — generates worker task list",
        worker: "Worker — cheap, TDD implementation",
        reviewer: "Reviewer — expensive, final quality gate",
      };

      const updatedPools = structuredClone(config.pools) as Record<string, { models: string[] }>;

      const subArg = args.trim().toLowerCase();
      const targetRoles = roles.filter((r) => !subArg || r === subArg);

      for (const role of targetRoles) {
        const currentModels: string[] =
          (config.pools[role as keyof typeof config.pools]?.models ?? []);

        const chosen = await pickModelsForRole(ctx, role, roleLabels[role], available, currentModels);
        if (chosen !== null) {
          updatedPools[role] = { models: chosen };
        }
      }

      saveConfig(agentDir, { ...config, pools: updatedPools });
      ctx.ui.notify("Pool configuration saved.", "success");
    },
  });

  // ── /job-status command ───────────────────────────────────────────────────

  pi.registerCommand("job-status", {
    description: "Show current job state and pipeline step.",
    handler: async (args, ctx) => {
      const state = readJobState(agentDir) as Record<string, unknown> | null;
      if (!state) {
        ctx.ui.notify("No active job. Start one with /job.", "info");
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

  // ── /job-abandon command ──────────────────────────────────────────────────

  pi.registerCommand("job-abandon", {
    description: "Abandon the current job and clear job state.",
    handler: async (args, ctx) => {
      const state = readJobState(agentDir) as Record<string, unknown> | null;
      if (!state) {
        ctx.ui.notify("No active job.", "info");
        return;
      }

      const confirmed = await ctx.ui.confirm(
        "Abandon Job",
        `Abandon job "${state.description}"? The worktree (if any) will NOT be automatically deleted.`,
      );
      if (!confirmed) return;

      clearJobState(agentDir);
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

  // ── Model picker helper ──────────────────────────────────────────────────

  /**
   * Show a scrollable, filterable SelectList for one role's model pool.
   * Supports multi-select via toggle: each selection adds/removes a model.
   * Returns the final selected model IDs, or null if cancelled.
   */
  async function pickModelsForRole(
    ctx: ExtensionContext,
    role: string,
    roleLabel: string,
    allModels: Array<{ fullId: string; name: string; provider: string }>,
    currentModels: string[],
  ): Promise<string[] | null> {
    const selected = new Set<string>(currentModels);

    // Loop until the user picks the sentinel "done" item or presses Escape.
    while (true) {
      const doneItem: SelectItem = {
        value: "__done__",
        label: selected.size > 0
          ? `✓ Done  (${selected.size} model${selected.size === 1 ? "" : "s"} selected)`
          : "✓ Done  (keep current)",
      };

      const modelItems: SelectItem[] = allModels.map((m) => ({
        value: m.fullId,
        label: (selected.has(m.fullId) ? "✓ " : "  ") + m.name,
        description: m.fullId,
      }));

      const choice = await ctx.ui.custom<string | null>((tui, theme, _kb, done) => {
        const container = new Container();

        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
        container.addChild(
          new Text(
            theme.fg("accent", theme.bold(`Pool: ${role}`)) +
            theme.fg("muted", `  —  ${roleLabel}`),
            1,
            0,
          ),
        );

        const listItems = [doneItem, ...modelItems];
        const selectList = new SelectList(listItems, Math.min(listItems.length, 12), {
          selectedPrefix: (t) => theme.fg("accent", t),
          selectedText: (t) => theme.fg("accent", t),
          description: (t) => theme.fg("dim", t),
          scrollInfo: (t) => theme.fg("dim", t),
          noMatch: (t) => theme.fg("warning", t),
        });
        selectList.onSelect = (item) => done(item.value);
        selectList.onCancel = () => done(null);
        container.addChild(selectList);

        container.addChild(
          new Text(
            theme.fg("dim", "↑↓ navigate  ⏎ toggle  type to filter  esc cancel"),
            1,
            0,
          ),
        );
        container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

        return {
          render: (w) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data) => { selectList.handleInput(data); tui.requestRender(); },
        };
      }, { overlay: true, overlayOptions: { anchor: "center", width: 72, maxHeight: 20 } });

      if (choice === null) {
        // Escape: cancel this role, keep original pool.
        return null;
      }
      if (choice === "__done__") {
        return selected.size > 0 ? Array.from(selected) : currentModels;
      }
      // Toggle the chosen model.
      if (selected.has(choice)) {
        selected.delete(choice);
      } else {
        selected.add(choice);
      }
    }
  }

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

    const retroOutput = await spawnAgent({
      modelId: (finalState.pool as Record<string, string>).planner,
      systemPrompt: retroPrompt({ jobSummary, previousChanges }),
      userPrompt: "Facilitate the retrospective.",
      signal,
    });

    let retroResult: Record<string, unknown>;
    try {
      retroResult = extractJson(retroOutput) as Record<string, unknown>;
    } catch {
      retroResult = { verdict: "clean", processChanges: [], summary: retroOutput };
    }

    let autonomyState = readAutonomyState(agentDir);
    const hasChanges =
      retroResult.verdict === "changes-proposed" &&
      Array.isArray(retroResult.processChanges) &&
      retroResult.processChanges.length > 0;

    autonomyState = hasChanges
      ? recordRetroWithChanges(autonomyState)
      : recordCleanRetro(autonomyState);
    writeAutonomyState(agentDir, autonomyState);

    if (gateMode === "compulsory") {
      const summary = (retroResult.summary as string) ?? retroOutput;
      const changes = Array.isArray(retroResult.processChanges)
        ? (retroResult.processChanges as { description: string }[])
            .map((c) => `- ${c.description}`)
            .join("\n")
        : "";

      await ctx.ui.confirm(
        "Retrospective",
        `${summary}\n\n${changes ? `Process changes proposed:\n${changes}` : "No process changes proposed."}\n\nStreak: ${autonomyState.cleanRetroStreak} / ${config_.autonomy.cleanRetrosRequired}\n\nAcknowledge?`,
      );

      if (shouldSuggestAutonomy(autonomyState, config_.autonomy)) {
        ctx.ui.notify(
          `Clean retro streak reached ${autonomyState.cleanRetroStreak}. Consider switching a gate to auto-accept via /job-pool.`,
          "success",
        );
      }
    } else {
      ctx.ui.notify(`Retro summary: ${retroResult.summary ?? "clean"}`, "info");
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

function buildJobSummary(state: Record<string, unknown>): string {
  const lines = [
    `Goal: ${state.description ?? "unknown"}`,
    `Total cycles: ${state.cycleIndex ?? 1}`,
    `Re-plans triggered: ${state.replanCount ?? 0}`,
    `Tasks: ${(state.taskGraph as { tasks?: unknown[] } | undefined)?.tasks?.length ?? 0}`,
  ];
  return lines.join("\n");
}
