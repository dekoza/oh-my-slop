# Agents, Tools, and Structured Output

Use this file for `langchain.agents.create_agent`, standard tool-calling agent behavior, middleware, and structured output.

## The current default: `create_agent`

The verified public entrypoint is `langchain.agents.create_agent`.

The source documents these key facts:
- `model` can be a string like `"openai:gpt-4o"` or a direct `BaseChatModel` instance.
- `tools` can be a list of `BaseTool`, callables, or tool dicts.
- `system_prompt` can be a string or `SystemMessage`.
- `middleware` is a first-class surface.
- `response_format` can be a `ToolStrategy`, `ProviderStrategy`, Pydantic model type, raw schema dict, or `None`.
- The return value is a compiled LangGraph state graph.

## Standard tool loop

The docstring spells out the standard tool calling loop:
1. the agent node calls the model with the current messages
2. if the returned `AIMessage` contains `tool_calls`, the graph calls the tools
3. tool results are appended as `ToolMessage` objects
4. the model is called again
5. the loop stops when no more `tool_calls` are present

If the task is just "model + tools until done," stay here. Do not jump into raw LangGraph without a reason.

## When `create_agent` is the right answer

Choose `create_agent` first when the user needs:
- a normal tool-calling assistant
- a quick agent with a system prompt and a few tools
- structured output on top of a standard agent loop
- middleware around model or tool calls without inventing a whole workflow engine

LangChain's own README recommends LangChain for quickly building agents and applications, and recommends LangGraph when advanced customization or carefully controlled workflow behavior is required.

## Structured output

Verified from the source:
- `response_format` may be a `ToolStrategy`
- `response_format` may be a `ProviderStrategy`
- it may also be a Pydantic model class or a raw schema dict
- raw schemas are wrapped in an appropriate strategy based on model capabilities

Practical rule:
- if the model/provider natively supports the schema path you need, `ProviderStrategy` may be appropriate
- if the output must be mediated through tool-style retries and validation, `ToolStrategy` is the explicit route

Do not pretend all structured output is the same thing.

## Middleware

Middleware is not decoration. It can intercept and modify agent behavior at multiple stages.

A critical verified footgun from the source:
- if middleware modifies `request.tools` to add **dynamic tools** that were not passed to `create_agent()`, the agent does not magically know how to execute them
- the source says to fix this by either:
  1. registering the tools up front with `create_agent(tools=[...])`, or
  2. implementing `wrap_tool_call` so middleware handles those dynamic tools itself

If an answer hand-waves dynamic tool registration away, it is wrong.

## Useful boundaries

- `create_agent` is already built on LangGraph. You do not need raw LangGraph for basic usage.
- If the user mostly needs custom state schemas, resumes after crashes, interrupts, or human approval steps, go to `langgraph-stateful-workflows.md`.
- If the task is mainly model initialization or LCEL composition, go to `models-prompts-runnables.md`.

## Review checklist

- Is `create_agent` sufficient, or is the task actually about workflow orchestration?
- Are tools registered at creation time?
- Does structured output need `ToolStrategy`, `ProviderStrategy`, or a simple schema?
- Does the answer preserve the documented tool loop instead of inventing custom glue?
- If middleware mutates tools, is tool execution still valid?

## References

- `create_agent` source: https://github.com/langchain-ai/langchain/blob/master/libs/langchain_v1/langchain/agents/factory.py
- `langchain.agents` export: https://github.com/langchain-ai/langchain/blob/master/libs/langchain_v1/langchain/agents/__init__.py
