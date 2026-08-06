# LangSmith Observability and Evals

Use this file for tracing, debugging, datasets, benchmark evaluation, and the pytest plugin.

## What LangSmith is for

The LangSmith SDK README says LangSmith helps teams **debug, evaluate, and monitor** language models and intelligent agents.

It also says LangSmith works with **any LLM application**, not only LangChain.

## Basic setup

Verified install and environment variables from the SDK README:

```bash
pip install -U langsmith
export LANGSMITH_TRACING=true
export LANGSMITH_API_KEY=ls_...
# Optional / sometimes required depending on account setup:
export LANGSMITH_WORKSPACE_ID=<workspace-id>
export LANGSMITH_PROJECT=<project-name>
export LANGSMITH_ENDPOINT=https://api.smith.langchain.com
```

The README also notes an EU endpoint variant when applicable.

## Tracing with LangChain

The SDK README states that if the environment variables are set correctly, LangChain applications automatically connect to LangSmith.

For low-friction tracing inside LangChain code, keep the environment variables explicit and then run your chain/agent/model normally.

## Tracing outside LangChain

Verified SDK surfaces include:
- `@traceable`
- `RunTree`
- `Client`
- wrappers such as `wrap_openai`

### `@traceable`

The easiest verified SDK path for custom code is the `@traceable` decorator.

### `wrap_openai`

The wrappers module explicitly exports `wrap_openai`.

Use it when the application is using the OpenAI Python SDK directly and you want LangSmith traces without rewriting everything around LangChain abstractions.

## Datasets and evaluations

Verified SDK exports include:
- `evaluate`
- `evaluate_existing`
- `aevaluate`
- `aevaluate_existing`

The README also shows dataset creation via `Client.create_dataset()` and `Client.create_example()` from existing runs.

That gives a simple evaluation workflow:
1. trace real runs
2. turn good/representative runs into a dataset
3. run evaluations against them

## Pytest plugin

The Python README has a dedicated **Pytest Plugin** section.

Verified behavior:
- the LangSmith pytest plugin is installed as part of the LangSmith SDK
- it is enabled by default
- it lets Python developers define datasets and evaluations as pytest test cases

If the user wants evaluation integrated into an existing Python test workflow, this is the documented route.

## Boundary rules

- LangSmith is not a replacement for LangGraph state management.
- LangSmith is not a provider SDK.
- LangSmith improves tracing and evaluation around your app; it does not build the runtime architecture for you.
- If the task is about agent orchestration, go back to LangChain or LangGraph.

## Review checklist

- Are `LANGSMITH_TRACING` and `LANGSMITH_API_KEY` configured explicitly?
- Is the app already using OpenAI directly, making `wrap_openai` the shortest path?
- Would `@traceable` give better coverage for custom business logic than only model wrappers?
- Does the user need datasets/evals rather than just raw traces?
- Would the pytest plugin fit the team's existing test workflow?

## References

- LangSmith SDK README: https://github.com/langchain-ai/langsmith-sdk
- Python README: https://github.com/langchain-ai/langsmith-sdk/blob/main/python/README.md
- Python package exports: https://github.com/langchain-ai/langsmith-sdk/blob/main/python/langsmith/__init__.py
- Wrappers exports: https://github.com/langchain-ai/langsmith-sdk/blob/main/python/langsmith/wrappers/__init__.py
