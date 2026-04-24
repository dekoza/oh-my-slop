# Models, Prompts, and Runnables

Use this file for `init_chat_model`, provider selection, configurable models, and LCEL / `Runnable` composition.

## `init_chat_model`

The verified current high-level entrypoint is `langchain.chat_models.init_chat_model`.

What the source guarantees:
- It initializes a chat model from any supported provider using a unified interface.
- It supports two modes:
  - **fixed model** — returns a ready-to-use chat model
  - **configurable model** — defers some parameters to runtime config
- It requires the provider integration package to be installed.

## Provider inference

The docstring says `init_chat_model()` will try to infer the provider from the model string. Verified examples include:
- `gpt-...`, `o1...`, `o3...` -> `openai`
- `claude...` -> `anthropic`
- `gemini...` -> `google_vertexai`
- `mistral...` -> `mistralai`
- `deepseek...` -> `deepseek`
- `grok...` -> `xai`
- `sonar...` -> `perplexity`

If the provider is not inferable, set `model_provider=` explicitly.

Verified provider/package mappings called out in the source include:
- `openai` -> `langchain-openai`
- `anthropic` -> `langchain-anthropic`
- `azure_openai` -> `langchain-openai`
- `bedrock` / `anthropic_bedrock` / `bedrock_converse` -> `langchain-aws`
- `google_vertexai` -> `langchain-google-vertexai`
- `google_genai` -> `langchain-google-genai`
- `groq` -> `langchain-groq`
- `ollama` -> `langchain-ollama`
- `openrouter` -> `langchain-openrouter`

## Exact model IDs beat aliases

The docstring explicitly recommends exact model IDs from provider docs over vague aliases for reliable behavior.

Do not tell users that `"latest"`-style aliases are safer than exact IDs when the verified source says the opposite.

## Configurable models

`init_chat_model()` supports runtime configurability through `config`.

Verified behavior:
- `configurable_fields=None` -> fixed model
- `configurable_fields="any"` -> all fields configurable
- `configurable_fields=(...)` -> only named fields configurable
- `config_prefix=` namespaces runtime config keys when multiple configurable models coexist

### Security note

The source contains an explicit **Security note** for `configurable_fields="any"`:
- untrusted runtime config can alter values like `api_key`, `base_url`, and other sensitive parameters
- if config comes from untrusted users, enumerate the allowed fields explicitly instead of exposing everything

That is not theoretical. Treat `configurable_fields="any"` as a review red flag.

## Typical usage pattern

```python
from langchain.chat_models import init_chat_model

model = init_chat_model("openai:gpt-4o", temperature=0)
response = model.invoke("Hello")
```

The same source also shows configurable usage via `config={"configurable": {...}}`.

## LCEL and `Runnable`

`langchain-core.runnables` defines LangChain's **Runnable** abstraction and the LangChain Expression Language (LCEL).

Verified from the source:
- `Runnable` programs inherently support **sync** execution
- **async** execution
- **batch** processing
- **streaming**

Useful exported building blocks include:
- `Runnable`
- `RunnableSequence`
- `RunnableParallel`
- `RunnableLambda`
- `RunnableWithFallbacks`
- `RunnableWithMessageHistory`
- `chain`

## Boundary rules

- Use `Runnable`/LCEL when the problem is mostly composition and transformation.
- Use `create_agent` when the problem is a standard model + tools loop.
- Use LangGraph when the problem is stateful workflow orchestration, durability, interrupts, or human intervention.
- Do not invent provider kwargs from memory. The source points you to the provider integration reference for supported parameters.

## Fast review checklist

- Is the import path coming from the correct package?
- Is the provider package installed (`langchain-openai`, `langchain-anthropic`, etc.)?
- Is the model string explicit enough for reliable provider inference?
- Is `configurable_fields="any"` exposing secrets or transport settings to untrusted input?
- Would a plain `Runnable` be simpler than an agent or graph?

## References

- `init_chat_model` source: https://github.com/langchain-ai/langchain/blob/master/libs/langchain_v1/langchain/chat_models/base.py
- `langchain-core` runnables source: https://github.com/langchain-ai/langchain/blob/master/libs/core/langchain_core/runnables/__init__.py
