# Package Map and Ownership

Use this file when the problem is really about **which package owns the feature**.

## The verified package map

### `langchain`
- The main LangChain package is described in the repo README as a framework for building agents and LLM-powered applications.
- The `libs/langchain_v1/README.md` file says LangChain is the easiest way to start building agents and applications powered by LLMs.
- For current Python agent/app work, this is the default package to reach for.

### `langchain-core`
- `langchain-core` owns the base abstractions for the ecosystem.
- Its top-level source explicitly says: **"No third-party integrations are defined here."**
- It contains interfaces for chat models, LLMs, vector stores, retrievers, and the universal `Runnable` protocol.
- If someone imports a provider from core, that answer is wrong.

### Provider packages
- Provider integrations are separate packages.
- Verified examples from the source tree:
  - `langchain-openai`
  - `langchain-anthropic`
  - `langchain-chroma`
  - `langchain-qdrant`
- The import path normally uses underscores while the pip package uses hyphens:
  - `langchain_openai` -> `pip install langchain-openai`
  - `langchain_qdrant` -> `pip install langchain-qdrant`
- Do not tell users that `pip install langchain` or `pip install langchain-core` is enough for provider-specific imports.

### `langchain-text-splitters`
- Text splitting is a separate package.
- Its README says it contains utilities for splitting a wide variety of text documents.
- Do not pretend text splitters live in `langchain-core` or a random vector-store package.

### `langgraph`
- LangGraph is the low-level orchestration framework for long-running, stateful agents.
- It is for stateful workflows, durable execution, memory, interrupts, and deeper control over execution.
- LangGraph can be used without LangChain, but LangChain agents are built on top of it.

### `langsmith`
- LangSmith is the tracing/evaluation/monitoring platform and SDK.
- The SDK README says it helps teams debug, evaluate, and monitor language models and intelligent agents.
- It is compatible with any LLM application, not only LangChain.

### `langchain-classic`
- `langchain-classic` is explicitly described as legacy chains, `langchain-community` re-exports, indexing API, deprecated functionality, and more.
- Its own README says that in most cases you should be using the main `langchain` package.
- Do not recommend `langchain-classic` for new code unless the task is maintaining legacy code already written against it.

## Common install triage

If code fails with an import error, answer in this order:
1. Identify the exact import path.
2. Map it to the owning pip package.
3. Check whether the task is current LangChain, LangGraph, LangSmith, or legacy `langchain-classic`.
4. Only then suggest installation or migration.

Examples:
- `from langchain_openai import ChatOpenAI` -> install `langchain-openai`
- `from langgraph.graph import StateGraph` -> install `langgraph`
- `from langsmith import traceable` -> install `langsmith`
- `from langchain_text_splitters import RecursiveCharacterTextSplitter` -> install `langchain-text-splitters`

## Ownership rules

- Model/provider integrations -> provider package + often `langchain`
- Core abstractions / LCEL / `Runnable` -> `langchain-core`
- Quick agent building -> `langchain`
- Durable stateful orchestration -> `langgraph`
- Tracing / datasets / evals / pytest integration -> `langsmith`
- Legacy chains / old tutorial code / community re-exports -> `langchain-classic`

## Hard bans

- Do not collapse the ecosystem into a single install instruction.
- Do not import providers from `langchain-core`.
- Do not recommend `langchain-classic` for greenfield code.
- Do not guess that a vector store or provider integration ships inside `langchain` when the source tree shows it is a separate package.

## References

- LangChain repo README: https://github.com/langchain-ai/langchain
- LangChain Core README: https://github.com/langchain-ai/langchain/tree/master/libs/core
- LangChain Classic README: https://github.com/langchain-ai/langchain/tree/master/libs/langchain
- LangGraph README: https://github.com/langchain-ai/langgraph
- LangSmith SDK README: https://github.com/langchain-ai/langsmith-sdk
