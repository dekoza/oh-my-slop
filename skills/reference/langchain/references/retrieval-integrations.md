# Retrieval, Text Splitting, and Integration Packages

Use this file for RAG/retrieval wiring, text splitters, embeddings/vector-store package boundaries, and installation advice.

## `langchain-text-splitters` is separate

The text splitters live in the dedicated `langchain-text-splitters` package.

Verified exports include:
- `RecursiveCharacterTextSplitter`
- `CharacterTextSplitter`
- `TokenTextSplitter`
- `MarkdownHeaderTextSplitter`
- `MarkdownTextSplitter`
- `HTMLHeaderTextSplitter`
- `HTMLSectionSplitter`
- `RecursiveJsonSplitter`
- `PythonCodeTextSplitter`

Important verified footgun from the package source:
- `MarkdownHeaderTextSplitter` and `HTMLHeaderTextSplitter` **do not derive from `TextSplitter`**.

Do not write code that assumes every splitter shares the exact same base class or API surface.

## Vector stores and retrieval integrations

Third-party vector stores are not part of `langchain-core`.

Verified package examples:
- `langchain-chroma` for Chroma
- `langchain-qdrant` for Qdrant

If the user is wiring Chroma or Qdrant through LangChain, tell them the provider package name explicitly. Do not bury it under generic `langchain` install advice.

## Practical package decomposition

A typical retrieval stack may involve multiple packages at once:
- `langchain` for higher-level app/agent wiring
- `langchain-core` for abstractions/runnables
- `langchain-text-splitters` for chunking
- a provider package for embeddings or chat models, such as `langchain-openai` or `langchain-anthropic`
- a vector-store package such as `langchain-chroma` or `langchain-qdrant`

That split is normal. Do not "simplify" it into a fake monolith.

## Chunking guidance

Start from the actual document shape:
- mixed prose -> `RecursiveCharacterTextSplitter`
- token-budget-sensitive chunking -> `TokenTextSplitter`
- Markdown with section-aware splitting -> `MarkdownHeaderTextSplitter` or `MarkdownTextSplitter`
- HTML-aware splitting -> `HTMLHeaderTextSplitter` or `HTMLSectionSplitter`
- code -> `PythonCodeTextSplitter`
- structured JSON -> `RecursiveJsonSplitter`

Do not recommend one splitter universally without considering the source format.

## Review checklist

- Is the splitter imported from `langchain_text_splitters`?
- Is the vector store coming from the correct provider package?
- Is the answer mixing `langchain-core` abstractions with provider-specific integrations incorrectly?
- Is the suggested splitter appropriate for the input format?
- Is the code assuming `MarkdownHeaderTextSplitter` or `HTMLHeaderTextSplitter` is a normal `TextSplitter` subclass when the package docs say otherwise?

## References

- Text splitters package source: https://github.com/langchain-ai/langchain/blob/master/libs/text-splitters/langchain_text_splitters/__init__.py
- Text splitters README: https://github.com/langchain-ai/langchain/tree/master/libs/text-splitters
- Chroma integration README: https://github.com/langchain-ai/langchain/tree/master/libs/partners/chroma
- Qdrant integration README: https://github.com/langchain-ai/langchain/tree/master/libs/partners/qdrant
