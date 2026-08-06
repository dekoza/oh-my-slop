# Migration, `langchain-classic`, and Common Gotchas

Use this file when the prompt includes old blog posts, stale tutorials, legacy imports, or code that feels like it belongs to a previous LangChain generation.

## `langchain-classic` means legacy

The verified `langchain-classic` README describes it as:
- legacy chains
- `langchain-community` re-exports
- indexing API
- deprecated functionality
- and more

The same README says that **in most cases you should be using the main `langchain` package**.

So treat `langchain-classic` as a compatibility surface, not the default answer.

## Old examples are often structurally wrong for current code

Typical migration smells:
- imports from `langchain-classic` for new work
- old prebuilt LangGraph types used as if they were still canonical
- tutorials that blur package boundaries and omit separate provider installs
- examples that assume `langchain` is a monolith containing every provider integration

## Verified moved/deprecated surfaces

### `AgentState` moved

LangGraph prebuilt source contains a deprecation warning that **`AgentState` has been moved to `langchain.agents`**.

If old code imports agent state types from LangGraph prebuilt modules, rewrite with current ownership in mind instead of preserving the stale import.

### `config_schema` deprecated

The `StateGraph` source explicitly says `config_schema` is deprecated and that `context_schema` should be used instead.

Fresh code should not be generated around `config_schema`.

### `langgraph.prebuilt` still exists, but that does not make it the default

Verified exports in `langgraph.prebuilt` include:
- `create_react_agent`
- `ToolNode`
- `tools_condition`
- `ValidationNode`

That means old LangGraph examples may still run, but it does **not** mean they are the best default for a new standard agent task. For current quick agents, start by checking whether `langchain.agents.create_agent` is the simpler modern surface.

## Migration review rules

When reviewing old LangChain code:
1. map every import to its current owning package
2. identify whether the code is really plain LangChain, LangGraph, or LangSmith
3. remove `langchain-classic` unless the feature is truly legacy-only
4. replace deprecated state/config surfaces with current ones
5. re-check separate provider installs instead of trusting old tutorial assumptions

## Do not preserve stale abstractions just because they still import

A migration is not successful because the code still imports.

Success means:
- ownership is correct
- current packages are explicit
- deprecated surfaces are removed where reasonable
- the code matches today's LangChain / LangGraph package split

## Review checklist

- Is `langchain-classic` being used only because of an old tutorial?
- Can the code move to `langchain` proper?
- Did agent state imports move to `langchain.agents`?
- Is any new graph code still using deprecated `config_schema`?
- Is `langgraph.prebuilt` being used intentionally, or just copied from an old example?
- Are provider integrations installed explicitly instead of assumed?

## References

- LangChain Classic README: https://github.com/langchain-ai/langchain/tree/master/libs/langchain
- LangChain main README: https://github.com/langchain-ai/langchain
- LangGraph prebuilt exports: https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/langgraph/prebuilt/__init__.py
- LangGraph prebuilt agent source: https://github.com/langchain-ai/langgraph/blob/main/libs/prebuilt/langgraph/prebuilt/chat_agent_executor.py
- LangGraph `StateGraph` source: https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/graph/state.py
