from __future__ import annotations

import json
import shutil
from pathlib import Path

from scripts.validate_refs import validate_repo


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "langchain"


def test_langchain_skill_references_resolve_in_isolation(tmp_path: Path) -> None:
    target_root = tmp_path / "skills" / "langchain"
    shutil.copytree(SKILL_ROOT, target_root)

    broken_references = validate_repo(tmp_path)

    assert broken_references == []


def test_langchain_skill_frontmatter_and_guardrails_cover_ecosystem_boundaries() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")

    assert "name: langchain" in skill_text
    assert "description: Use when" in skill_text
    assert "LangGraph" in skill_text
    assert "LangSmith" in skill_text
    assert "Python" in skill_text
    assert "`langchain-core`" in skill_text
    assert "`langchain-classic`" in skill_text
    assert "`langchain-text-splitters`" in skill_text
    assert "`init_chat_model`" in skill_text
    assert "`create_agent`" in skill_text
    assert "`StateGraph`" in skill_text
    assert "`InMemorySaver`" in skill_text
    assert "LangChain.js" in skill_text or "JS/TS" in skill_text


def test_langchain_reference_index_covers_all_major_domains() -> None:
    index_text = (SKILL_ROOT / "references" / "REFERENCE.md").read_text(
        encoding="utf-8"
    )

    assert "package-map.md" in index_text
    assert "models-prompts-runnables.md" in index_text
    assert "agents-tools-structured-output.md" in index_text
    assert "retrieval-integrations.md" in index_text
    assert "langgraph-stateful-workflows.md" in index_text
    assert "langsmith-observability-evals.md" in index_text
    assert "migration-classic-gotchas.md" in index_text


def test_langchain_references_cover_verified_package_and_runtime_boundaries() -> None:
    package_text = (SKILL_ROOT / "references" / "package-map.md").read_text(
        encoding="utf-8"
    )
    models_text = (
        SKILL_ROOT / "references" / "models-prompts-runnables.md"
    ).read_text(encoding="utf-8")
    agents_text = (
        SKILL_ROOT / "references" / "agents-tools-structured-output.md"
    ).read_text(encoding="utf-8")
    retrieval_text = (
        SKILL_ROOT / "references" / "retrieval-integrations.md"
    ).read_text(encoding="utf-8")
    langgraph_text = (
        SKILL_ROOT / "references" / "langgraph-stateful-workflows.md"
    ).read_text(encoding="utf-8")
    langsmith_text = (
        SKILL_ROOT / "references" / "langsmith-observability-evals.md"
    ).read_text(encoding="utf-8")
    migration_text = (
        SKILL_ROOT / "references" / "migration-classic-gotchas.md"
    ).read_text(encoding="utf-8")

    assert "`langchain`" in package_text
    assert "`langchain-core`" in package_text
    assert "`langchain-classic`" in package_text
    assert "`langchain-text-splitters`" in package_text
    assert "`langgraph`" in package_text
    assert "`langsmith`" in package_text
    assert "No third-party integrations are defined here" in package_text
    assert "`langchain-openai`" in package_text
    assert "`langchain-anthropic`" in package_text
    assert "`langchain-chroma`" in package_text
    assert "`langchain-qdrant`" in package_text

    assert "`init_chat_model`" in models_text
    assert "`configurable_fields=\"any\"`" in models_text
    assert "Security note" in models_text
    assert "`Runnable`" in models_text
    assert "sync" in models_text and "async" in models_text
    assert "batch" in models_text and "streaming" in models_text
    assert "`langchain-openai`" in models_text
    assert "`langchain-anthropic`" in models_text

    assert "`create_agent`" in agents_text
    assert "`response_format`" in agents_text
    assert "tool calling loop" in agents_text or "tool loop" in agents_text
    assert "`ToolStrategy`" in agents_text
    assert "`ProviderStrategy`" in agents_text
    assert "middleware" in agents_text.lower()
    assert "dynamic tools" in agents_text.lower()

    assert "`langchain-text-splitters`" in retrieval_text
    assert "`RecursiveCharacterTextSplitter`" in retrieval_text
    assert "`MarkdownHeaderTextSplitter`" in retrieval_text
    assert "do not derive from `TextSplitter`" in retrieval_text
    assert "`langchain-chroma`" in retrieval_text
    assert "`langchain-qdrant`" in retrieval_text
    assert "provider package" in retrieval_text.lower()

    assert "`StateGraph`" in langgraph_text
    assert "builder class" in langgraph_text.lower()
    assert "`.compile()`" in langgraph_text
    assert "`MessagesState`" in langgraph_text
    assert "`add_messages`" in langgraph_text
    assert "`InMemorySaver`" in langgraph_text
    assert "debugging or testing" in langgraph_text.lower()
    assert "`create_react_agent`" in langgraph_text
    assert "`AgentState` has been moved to `langchain.agents`" in langgraph_text
    assert "`config_schema`" in langgraph_text and "deprecated" in langgraph_text.lower()

    assert "`LANGSMITH_TRACING`" in langsmith_text
    assert "`@traceable`" in langsmith_text
    assert "`wrap_openai`" in langsmith_text
    assert "`evaluate`" in langsmith_text
    assert "pytest plugin" in langsmith_text.lower()
    assert "dataset" in langsmith_text.lower()

    assert "legacy" in migration_text.lower()
    assert "`langchain-classic`" in migration_text
    assert "deprecated functionality" in migration_text.lower()
    assert "re-exports" in migration_text.lower()
    assert "`langchain.agents`" in migration_text
    assert "`langgraph.prebuilt`" in migration_text


def test_langchain_skill_evals_cover_boundary_scenarios() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))

    assert payload["skill_name"] == "langchain"
    evals = payload["evals"]
    assert len(evals) >= 7
    assert len({item["id"] for item in evals}) == len(evals)

    prompts = "\n".join(item["prompt"] for item in evals)
    expectations = "\n".join(
        expectation for item in evals for expectation in item["expectations"]
    )

    assert "ImportError" in prompts or "ModuleNotFoundError" in prompts
    assert "create_agent" in prompts or "tool-calling agent" in prompts
    assert "LangGraph" in prompts
    assert "RAG" in prompts or "retrieval" in prompts
    assert "LangSmith" in prompts
    assert "langchain-classic" in prompts or "legacy blog post" in prompts
    assert "configurable_fields=\"any\"" in prompts or "configurable_fields='any'" in prompts

    assert "`langchain-openai`" in expectations
    assert "`StateGraph`" in expectations
    assert "`InMemorySaver`" in expectations
    assert "`LANGSMITH_TRACING`" in expectations
    assert "`langchain-classic`" in expectations
    assert all(item["expected_output"] and item["expectations"] for item in evals)


def test_readme_lists_langchain_skill() -> None:
    readme_text = (REPO_ROOT / "README.md").read_text(encoding="utf-8")

    assert "[LangChain](skills/langchain/SKILL.md)" in readme_text
    assert "LangGraph" in readme_text
    assert "LangSmith" in readme_text
