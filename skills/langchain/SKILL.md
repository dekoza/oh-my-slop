---
name: langchain
description: >
  Use when working with the Python LangChain ecosystem — `langchain`, `langchain-core`,
  provider packages, `langgraph`, `langsmith`, or migration off legacy imports.
  Triggers on: "LangChain", "LangGraph", "LangSmith", `init_chat_model` /
  `create_agent` / `StateGraph`, RAG or retrieval wiring, a LangChain import error or
  package-confusion question, or an old tutorial whose imports no longer exist.
  Not for LangChain.js / JS/TS.
scope: langchain-python
last_verified: 2026-04-24
source_basis: official docs + source code + README
---

# LangChain Python Ecosystem Reference

Use this skill for **Python** LangChain ecosystem work. It covers package boundaries, model initialization, LCEL/runnables, agent construction, retrieval wiring, LangGraph stateful workflows, LangSmith tracing/evals, and migration away from legacy imports. Read only the reference files needed for the task.

If the user is working on **LangChain.js / LangGraph.js / JS/TS**, do not reuse Python imports or package advice from this skill. Go to the JS/TS docs instead.

## Critical Rules

1. **Do not treat the ecosystem as one package** — `langchain`, `langchain-core`, provider integrations, `langgraph`, `langsmith`, and `langchain-classic` have different roles.
2. **Check installed versions before trusting import advice** — run `pip show langchain langchain-core langgraph` (or read the lockfile) first; the 0.x and 1.x generations moved imports, and advice for the wrong generation produces confident-looking broken code.
3. **`langchain-core` owns abstractions, not integrations** — Its own source says: "No third-party integrations are defined here." Do not invent provider imports from core.
4. **Provider integrations live in separate packages** — Examples verified from source: `langchain-openai`, `langchain-anthropic`, `langchain-chroma`, `langchain-qdrant`.
5. **Prefer main `langchain` for current agent/app work** — The `langchain-classic` package is explicitly for legacy chains, community re-exports, indexing API, deprecated functionality, and more.
6. **Use `create_agent` for standard tool-loop agents** — LangChain recommends LangGraph only when you need heavier customization, deterministic + agentic orchestration, or carefully controlled state/latency.
7. **Use LangGraph when durability or human intervention is required** — `StateGraph` is the low-level orchestration framework for long-running, stateful workflows.
8. **`StateGraph` must be compiled before execution** — The source explicitly says the builder cannot execute until `.compile()` is called.
9. **`InMemorySaver` is not a production persistence strategy** — LangGraph documents it for debugging or testing and recommends a durable saver such as Postgres for production.
10. **LangSmith is observability/evals, not runtime orchestration** — Use it for tracing, datasets, benchmarking, pytest-based evaluation, and monitoring. Tracing ships prompts, completions, and metadata to LangSmith's backend and is billed per trace — flag the privacy and cost implications instead of enabling it silently.
11. **Do not guess provider params or model IDs** — `init_chat_model()` requires the provider package to be installed and recommends exact model IDs from provider docs.
12. **Treat `configurable_fields="any"` as a security risk** — The source explicitly warns that runtime config can alter `api_key`, `base_url`, and other sensitive fields.
13. **Legacy snippets need migration review before reuse** — Old examples may point at `langchain-classic`, `langchain_community`, deprecated LangGraph types, or outdated imports.

## When Not To Use This Skill

- **LangChain.js / LangGraph.js** — This skill is Python-only.
- **Generic provider SDK work without LangChain** — Use provider-native docs when the code does not use LangChain abstractions.
- **Pure vector database administration** — Cluster ops, index tuning, or deployment for Qdrant/Chroma/etc. are out of scope unless the task is specifically LangChain integration wiring.
- **Framework lifecycle questions** — Pair the relevant framework skill when request lifetimes, background jobs, or server startup/shutdown behavior belong to Django, Litestar, FastAPI, or another framework.
- **Async correctness itself** — LangChain's `ainvoke`/`astream` surface is covered here, but event-loop ownership, cancellation, and task-group design belong to the `python-async` skill.

## Reference Map

| File | Domain | Use For |
|------|--------|---------|
| `references/REFERENCE.md` | Index | Cross-file routing and reading order |
| `references/package-map.md` | Package ownership | Which pip package owns which surface |
| `references/models-prompts-runnables.md` | Models & LCEL | `init_chat_model`, provider inference, configurable models, sync/async `Runnable` composition |
| `references/agents-tools-structured-output.md` | Agents | `create_agent`, tool loop, middleware, structured output |
| `references/retrieval-integrations.md` | RAG wiring | text splitters, provider packages, vector store boundaries |
| `references/langgraph-stateful-workflows.md` | Stateful orchestration | `StateGraph`, `MessagesState`, checkpointers, interrupts, prebuilt nodes |
| `references/langsmith-observability-evals.md` | Observability | tracing, `@traceable`, wrappers, datasets, evals, pytest plugin |
| `references/migration-classic-gotchas.md` | Legacy cleanup | `langchain-classic`, moved/deprecated APIs, stale blog-post imports |

## Task Routing

Identify the owning package first, open the single best reference, and add a second only when the task crosses a real boundary (such as `create_agent` + LangGraph persistence, or RAG + provider packages).

- **Import error, install question, package confusion** -> `references/package-map.md`
- **Model initialization, provider string, configurable model, LCEL pipeline, sync-vs-async calls** -> `references/models-prompts-runnables.md`
- **Standard tool-calling agent, middleware, structured output** -> `references/agents-tools-structured-output.md`
- **RAG / retrieval / chunking / vector store wiring** -> `references/retrieval-integrations.md`
- **Long-running workflow, persistence, interrupts, subgraphs, prebuilt nodes** -> `references/langgraph-stateful-workflows.md`
- **Tracing, datasets, benchmark evals, pytest integration** -> `references/langsmith-observability-evals.md`
- **Old tutorial, `langchain-classic`, deprecated imports, migration review** -> `references/migration-classic-gotchas.md`

## Output Expectations

- Name the reference files used and the owning package(s) explicitly, including any separate pip packages that must be installed.
- State whether the task belongs in plain LangChain, LangGraph, or LangSmith.
- If the answer depends on current package generation, say so plainly instead of pretending old blog posts are current.
- State the minimum verification step: import smoke test, runnable/agent smoke test, LangGraph checkpoint test, or LangSmith trace/eval smoke test.
