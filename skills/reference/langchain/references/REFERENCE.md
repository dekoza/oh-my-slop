# LangChain Reference Index

Start here when the task spans multiple LangChain surfaces and you need to decide which file to read next.

## Fast routing

| If the task is mainly about... | Read this first | Add this second when... |
|---|---|---|
| package confusion, install errors, import paths | `package-map.md` | `migration-classic-gotchas.md` for old examples |
| model setup, provider inference, LCEL, runnables | `models-prompts-runnables.md` | `agents-tools-structured-output.md` if the runnable becomes an agent |
| tool-calling agents, middleware, structured output | `agents-tools-structured-output.md` | `langgraph-stateful-workflows.md` if persistence/interrupts matter |
| RAG, chunking, vector stores, integration packages | `retrieval-integrations.md` | `models-prompts-runnables.md` for model/embedding config |
| durable workflows, approvals, resumes, state inspection | `langgraph-stateful-workflows.md` | `langsmith-observability-evals.md` for debugging/evals |
| tracing, datasets, benchmark evals, pytest integration | `langsmith-observability-evals.md` | `agents-tools-structured-output.md` or `langgraph-stateful-workflows.md` for runtime context |
| legacy snippets or stale blog posts | `migration-classic-gotchas.md` | `package-map.md` to rebuild the package map cleanly |

## File summaries

- `package-map.md` — verified package ownership for `langchain`, `langchain-core`, `langchain-classic`, provider packages, `langchain-text-splitters`, `langgraph`, and `langsmith`.
- `models-prompts-runnables.md` — `init_chat_model`, provider inference, configurable model security notes, and LCEL / `Runnable` composition.
- `agents-tools-structured-output.md` — `create_agent`, standard tool loop behavior, middleware boundaries, structured output, and when not to drop into LangGraph.
- `retrieval-integrations.md` — text splitters, retrieval package boundaries, and vector-store integration packaging.
- `langgraph-stateful-workflows.md` — `StateGraph`, `MessagesState`, `add_messages`, checkpointers, interrupts, `ToolNode`, and prebuilt agent surfaces.
- `langsmith-observability-evals.md` — environment variables, `@traceable`, `wrap_openai`, datasets, `evaluate`, and the pytest plugin.
- `migration-classic-gotchas.md` — legacy `langchain-classic` usage, moved APIs, deprecations, and upgrade-minded review questions.

## Cross-cutting reminders

- Package names and import paths are not interchangeable. Verify both.
- The ecosystem moves fast. Match advice to the installed generation, not to a random blog post.
- When a task smells like basic tool-calling, start in LangChain. When it smells like workflow orchestration, start in LangGraph.
- LangSmith improves observability and evaluation. It does not replace LangGraph state management or LangChain runtime code.
