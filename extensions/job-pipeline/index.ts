import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getAgentDir, DynamicBorder } from "@mariozechner/pi-coding-agent";
import { type SelectItem, SelectList, Text } from "@mariozechner/pi-tui";
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
import { getRoleThinkingLevel } from "./lib/thinking.mjs";
import {
  buildInterviewCapturedMessage,
  createInitialJobState,
  formatPipelineError,
} from "./lib/runtime-helpers.mjs";

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
        content: [{ type: "text", text: buildInterviewCapturedMessage() }],
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

      const existing = readJobState(agentDir) as Record<string, unknown> | null;

      // Backfill cwd for pre-fix states so resume does not depend on ambient process cwd.
      if (existing && !existing.cwd) {
        existing.cwd = ctx.cwd;
        existing.updatedAt = Date.now();
        writeJobState(agentDir, existing);
      }

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
      const initialState = createInitialJobState({
        id: jobId,
        description,
        cwd: ctx.cwd,
      });
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
      thinkingLevel: getRoleThinkingLevel('planner'),
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
