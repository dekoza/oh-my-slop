# LangGraph Stateful Workflows

Use this file when the task is really about **workflow orchestration**, not just a standard tool-calling agent.

## What LangGraph is for

The verified README describes LangGraph as a **low-level orchestration framework for building stateful agents**.

LangGraph is the right surface when the user needs:
- durable execution
- long-running workflows
- human-in-the-loop approvals
- explicit state transitions
- workflow memory/persistence
- custom branching and control flow

LangChain's README also says LangGraph should be used when advanced needs require deterministic + agentic workflows, heavy customization, or carefully controlled latency.

## `StateGraph`

The primary low-level builder is `StateGraph`.

Critical verified rule from the source:
- `StateGraph` is a **builder class**
- it cannot execute directly
- you must call **`.compile()`** before using methods like `invoke()`, `stream()`, `astream()`, or `ainvoke()`

If an answer treats `StateGraph` like a directly executable object, it is wrong.

## State and message helpers

Verified LangGraph message helpers include:
- `MessagesState`
- `add_messages`

`add_messages` merges message lists and updates existing messages by ID.

Use these when the workflow state is message-centric. Do not reinvent custom append-only message logic unless you actually need a different reducer.

## Persistence and checkpointers

Verified from `InMemorySaver` source:
- `InMemorySaver` exists in `langgraph.checkpoint.memory`
- it is intended for **debugging or testing**
- for production, the source recommends a durable saver such as Postgres
- if using LangSmith Deployment, the correct managed checkpointer may be supplied automatically

Treat `InMemorySaver` as a local/dev tool, not a production durability plan.

## Interrupts, commands, and sends

LangGraph types export `Command`, `Send`, and `interrupt` support for graph control flow.

Use these concepts when the workflow needs explicit routing or pause/resume semantics. Do not overcomplicate simple agents with them.

## Prebuilt components

Verified prebuilt exports from `langgraph.prebuilt` include:
- `create_react_agent`
- `ToolNode`
- `tools_condition`
- `ValidationNode`
- `InjectedState`
- `InjectedStore`
- `ToolRuntime`

These are useful when the task already lives in LangGraph and needs graph-native tool execution or injection of state/store/runtime.

### `ToolNode`

The `ToolNode` docs explicitly call out:
- parallel execution of multiple tool calls
- error handling
- state injection
- store injection
- command-based state updates

If the workflow is already graph-native, `ToolNode` is the documented surface. Do not reimplement it blindly.

## Current migration footguns

### `AgentState` moved

The current LangGraph prebuilt source carries a deprecation warning stating:
- **`AgentState` has been moved to `langchain.agents`**

So if old code imports `AgentState` from LangGraph prebuilt types, treat that as migration work, not a clean modern starting point.

### `config_schema` deprecated

The `StateGraph` source explicitly marks **`config_schema`** as deprecated in v0.6.0 and says to use **`context_schema`** instead.

Do not write fresh examples around `config_schema`.

## Decision rule

- **Standard tool loop** -> prefer `langchain.agents.create_agent`
- **Stateful workflow with explicit graph control** -> use `StateGraph`
- **Graph-native tool execution / injection** -> use `langgraph.prebuilt.ToolNode` and related helpers
- **Need persistence** -> choose a real checkpointer, not `InMemorySaver`

## Review checklist

- Does the problem actually require LangGraph, or would `create_agent` be enough?
- Was `.compile()` called before execution?
- Is message state using `MessagesState` / `add_messages` where appropriate?
- Is persistence handled with a real saver instead of `InMemorySaver`?
- Is the code using deprecated `AgentState` or `config_schema` patterns?
- Would `create_react_agent` or `ToolNode` remove custom boilerplate safely?

## References

- LangGraph README: https://github.com/langchain-ai/langgraph
- `StateGraph` source: https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/graph/state.py
- Message helpers source: https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/graph/message.py
- `InMemorySaver` source: https://github.com/langchain-ai/langgraph/blob/main/libs/checkpoint/langgraph/checkpoint/memory/__init__.py
- Prebuilt exports: https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/langgraph/prebuilt/__init__.py
- `ToolNode` source: https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/langgraph/prebuilt/tool_node.py
