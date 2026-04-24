---
name: langchain
description: Use when tasks involve the Python LangChain ecosystem including `langchain`, `langchain-core`, provider packages like `langchain-openai`, `langgraph`, `langsmith`, LCEL/runnables, `init_chat_model`, `create_agent`, RAG/retrieval wiring, structured output, tracing, evals, or migration off `langchain-classic`. Use this whenever a task mentions LangChain, LangGraph, LangSmith, tool-calling agents, vector-store integrations, or imports/packages from this ecosystem. Do not use for LangChain.js / JS/TS.
scope: langchain-python
last_verified: 2026-04-24
source_basis: official docs + source code + README
---

# LangChain Python Ecosystem Reference

Use this skill for **Python** LangChain ecosystem work. It covers package boundaries, model initialization, LCEL/runnables, agent construction, retrieval wiring, LangGraph stateful workflows, LangSmith tracing/evals, and migration away from legacy imports. Read only the reference files needed for the task.

If the user is working on **LangChain.js / LangGraph.js / JS/TS**, do not reuse Python imports or package advice from this skill. Go to the JS/TS docs instead.

## Quick Start

1. Identify the owning package first: `langchain`, `langchain-core`, a provider package, `langgraph`, `langsmith`, or legacy `langchain-classic`.
2. Open the single best reference file from `references/`.
3. Add a second reference only when the task crosses a real boundary, such as `create_agent` + LangGraph persistence or RAG + provider packages.
4. Verify imports and pip package names before writing code.
5. State which reference files you used and what tests or smoke checks are required.

## When Not To Use This Skill

- **LangChain.js / LangGraph.js** — This skill is Python-only.
- **Generic provider SDK work without LangChain** — Use provider-native docs when the code does not use LangChain abstractions.
- **Pure vector database administration** — Cluster ops, index tuning, or deployment for Qdrant/Chroma/etc. are out of scope unless the task is specifically LangChain integration wiring.
- **Framework lifecycle questions** — Pair the relevant framework skill when request lifetimes, background jobs, or server startup/shutdown behavior belong to Django, Litestar, FastAPI, or another framework.

## Critical Rules

1. **Do not treat the ecosystem as one package** — `langchain`, `langchain-core`, provider integrations, `langgraph`, `langsmith`, and `langchain-classic` have different roles.
2. **`langchain-core` owns abstractions, not integrations** — Its own source says: "No third-party integrations are defined here." Do not invent provider imports from core.
3. **Provider integrations live in separate packages** — Examples verified from source: `langchain-openai`, `langchain-anthropic`, `langchain-chroma`, `langchain-qdrant`.
4. **Prefer main `langchain` for current agent/app work** — The `langchain-classic` package is explicitly for legacy chains, community re-exports, indexing API, deprecated functionality, and more.
5. **Use `create_agent` for standard tool-loop agents** — LangChain recommends LangGraph only when you need heavier customization, deterministic + agentic orchestration, or carefully controlled state/latency.
6. **Use LangGraph when durability or human intervention is required** — `StateGraph` is the low-level orchestration framework for long-running, stateful workflows.
7. **`StateGraph` must be compiled before execution** — The source explicitly says the builder cannot execute until `.compile()` is called.
8. **`InMemorySaver` is not a production persistence strategy** — LangGraph documents it for debugging or testing and recommends a durable saver such as Postgres for production.
9. **LangSmith is observability/evals, not runtime orchestration** — Use it for tracing, datasets, benchmarking, pytest-based evaluation, and monitoring.
10. **Do not guess provider params or model IDs** — `init_chat_model()` requires the provider package to be installed and recommends exact model IDs from provider docs.
11. **Treat `configurable_fields="any"` as a security risk** — The source explicitly warns that runtime config can alter `api_key`, `base_url`, and other sensitive fields.
12. **Legacy snippets need migration review before reuse** — Old examples may point at `langchain-classic`, deprecated LangGraph types, or outdated imports.

## Reference Map

| File | Domain | Use For |
|------|--------|---------|
| `references/REFERENCE.md` | Index | Cross-file routing and reading order |
| `references/package-map.md` | Package ownership | Which pip package owns which surface |
| `references/models-prompts-runnables.md` | Models & LCEL | `init_chat_model`, provider inference, configurable models, `Runnable` composition |
| `references/agents-tools-structured-output.md` | Agents | `create_agent`, tool loop, middleware, structured output |
| `references/retrieval-integrations.md` | RAG wiring | text splitters, provider packages, vector store boundaries |
| `references/langgraph-stateful-workflows.md` | Stateful orchestration | `StateGraph`, `MessagesState`, checkpointers, interrupts, prebuilt nodes |
| `references/langsmith-observability-evals.md` | Observability | tracing, `@traceable`, wrappers, datasets, evals, pytest plugin |
| `references/migration-classic-gotchas.md` | Legacy cleanup | `langchain-classic`, moved/deprecated APIs, stale blog-post imports |

## Task Routing

- **Import error, install question, package confusion** -> `references/package-map.md`
- **Model initialization, provider string, configurable model, LCEL pipeline** -> `references/models-prompts-runnables.md`
- **Standard tool-calling agent, middleware, structured output** -> `references/agents-tools-structured-output.md`
- **RAG / retrieval / chunking / vector store wiring** -> `references/retrieval-integrations.md`
- **Long-running workflow, persistence, interrupts, subgraphs, prebuilt nodes** -> `references/langgraph-stateful-workflows.md`
- **Tracing, datasets, benchmark evals, pytest integration** -> `references/langsmith-observability-evals.md`
- **Old tutorial, `langchain-classic`, deprecated imports, migration review** -> `references/migration-classic-gotchas.md`

## Output Expectations

- Name the reference files used.
- Name the owning package(s) explicitly.
- Call out any separate pip packages that must be installed.
- State whether the task belongs in plain LangChain, LangGraph, or LangSmith.
- If the answer depends on current package generation, say so plainly instead of pretending old blog posts are current.
- State the minimum verification step: import smoke test, runnable/agent smoke test, LangGraph checkpoint test, or LangSmith trace/eval smoke test.

## Content Ownership

This skill owns the **Python LangChain ecosystem**: `langchain`, `langchain-core`, provider integration packages, `langchain-text-splitters`, `langgraph`, `langsmith`, current agent APIs, LCEL/runnables, retrieval wiring, tracing/evals, and legacy migration boundaries.

This skill does not own LangChain.js / LangGraph.js or provider-native SDK design outside LangChain usage.
