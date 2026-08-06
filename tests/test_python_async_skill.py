from __future__ import annotations

import json
import shutil
from pathlib import Path

from scripts.validate_refs import validate_repo


REPO_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPO_ROOT / "skills" / "reference" / "python-async"


def test_python_async_skill_references_resolve_in_isolation(tmp_path: Path) -> None:
    target_root = tmp_path / "skills" / "python-async"
    shutil.copytree(SKILL_ROOT, target_root)

    broken_references = validate_repo(tmp_path)

    assert broken_references == []


def test_python_async_skill_guardrails_cover_major_async_footguns() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    decision_text = (SKILL_ROOT / "references" / "decision-matrix.md").read_text(
        encoding="utf-8"
    )
    asyncio_text = (SKILL_ROOT / "references" / "backend-asyncio.md").read_text(
        encoding="utf-8"
    )
    cancellation_text = (
        SKILL_ROOT / "references" / "cancellation-timeouts.md"
    ).read_text(encoding="utf-8")
    structured_text = (
        SKILL_ROOT / "references" / "structured-concurrency.md"
    ).read_text(encoding="utf-8")
    testing_text = (SKILL_ROOT / "references" / "testing.md").read_text(
        encoding="utf-8"
    )
    thread_text = (SKILL_ROOT / "references" / "threads-boundaries.md").read_text(
        encoding="utf-8"
    )
    uvloop_text = (SKILL_ROOT / "references" / "backend-uvloop.md").read_text(
        encoding="utf-8"
    )

    assert "`uvloop` is not a third async model" in skill_text
    assert (
        "Do not spelunk site-packages" in skill_text
        or "repo-local references" in skill_text
    )
    assert "`AnyIO-portable`" in decision_text
    assert "`asyncio-specific`" in decision_text
    assert "`Trio-specific`" in decision_text
    assert "`asyncio-runtime-specific`" in decision_text
    assert "Do not recommend raw `asyncio.shield()`" in cancellation_text
    assert "uncancel()" in asyncio_text
    assert "supported CPython/POSIX" in uvloop_text
    assert "Windows" in uvloop_text
    assert "conflicts with `pytest-asyncio` auto mode" in testing_text
    assert "not a portability layer and not a Trio feature" in uvloop_text
    assert "plain data snapshots" in structured_text
    assert "failure observation" in structured_text or "dead-letter" in structured_text
    assert "current_token()" in thread_text
    assert "set an AnyIO `Event`" in thread_text
    assert "Do not reach for `BlockingPortal`" in thread_text


def test_python_async_skill_makes_thread_bridge_callable_split_explicit() -> None:
    skill_text = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
    thread_text = (SKILL_ROOT / "references" / "threads-boundaries.md").read_text(
        encoding="utf-8"
    )

    assert "`from_thread.run()`" in skill_text
    assert "`from_thread.run_sync()`" in skill_text
    assert "callable split" in skill_text.lower()
    assert "Examples of `from_thread.run()` use" in thread_text
    assert (
        "Do not collapse `from_thread.run()` and `from_thread.run_sync()`"
        in thread_text
    )


def test_python_async_skill_evals_cover_core_risk_areas() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))

    assert payload["skill_name"] == "python-async"
    evals = payload["evals"]
    assert len(evals) >= 6
    assert len({item["id"] for item in evals}) == len(evals)

    prompts = [item["prompt"] for item in evals]

    assert any("AnyIO" in prompt and "Trio" in prompt for prompt in prompts)
    assert any(
        "CancelledError" in prompt and "asyncio.shield()" in prompt
        for prompt in prompts
    )
    assert any("pytest-asyncio" in prompt and "uvloop" in prompt for prompt in prompts)
    assert any(
        "uvloop" in prompt and "public async library" in prompt for prompt in prompts
    )
    assert any(
        "asyncio.gather()" in prompt and "create_task()" in prompt for prompt in prompts
    )
    assert any(
        "BlockingPortal" in prompt and "asyncio.run()" in prompt for prompt in prompts
    )

    assert all(item["expectations"] and item["expected_output"] for item in evals)


def test_python_async_evals_target_discriminating_failure_modes() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))
    evals = payload["evals"]

    assert len(evals) >= 7

    prompts = "\n".join(item["prompt"] for item in evals)
    lowered_prompts = prompts.lower()
    expectations = "\n".join(
        expectation for item in evals for expectation in item["expectations"]
    )
    lowered_expectations = expectations.lower()

    assert "not subject to AnyIO's cancellation rules" in expectations
    assert "uncancel()" in expectations
    assert "higher-scope `anyio_backend` fixture" in expectations
    assert "contextvars" in expectations
    assert "supported CPython/POSIX runtimes" in expectations
    assert "current_token()" in expectations
    assert (
        "`from_thread.run()` / `from_thread.run_sync()` work directly only"
        in expectations
    )
    assert "buffer size `0`" in expectations
    assert "`math.inf`" in expectations
    assert "single-use" in expectations
    assert "`TaskGroup.start()`" in expectations
    assert "`task_status.started()`" in expectations
    assert "`RuntimeError`" in expectations
    assert "eager task" in lowered_expectations or "eager_task_factory" in expectations
    assert "can leak within that runner" in lowered_expectations
    assert (
        "plain data" in lowered_expectations or "request-bound" in lowered_expectations
    )
    assert "`from_thread.run_sync()`" in expectations
    assert "`from_thread.check_cancelled()`" in expectations

    assert "module-scoped async fixture" in prompts
    assert "PyPy" in prompts or "CPython" in prompts
    assert "vendor SDK" in prompts
    assert "TCP listener" in prompts
    assert "eager task factory" in prompts or "eager_start" in prompts
    assert (
        "forgets to call `task_status.started()`" in prompts
        or "never signals readiness" in prompts
    )
    assert "DB session" in prompts or "request object" in prompts
    assert (
        "loop-thread sync callback" in lowered_prompts
        or "set an anyio" in lowered_prompts
    )

    assert "labels the answer as" not in lowered_expectations
    assert "names the references used" not in lowered_expectations


def test_eval_5_checks_background_boundary_policy_with_separate_assertions() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))
    eval_5 = next(item for item in payload["evals"] if item["id"] == 5)
    prompt = eval_5["prompt"]
    expectations = "\n".join(eval_5["expectations"])

    assert "asyncio.gather()" in prompt
    assert "create_task()" in prompt
    assert "request" in prompt
    assert "DB session" in prompt
    assert "tracing span" in prompt
    assert "eager task factory" in prompt or "eager_start" in prompt

    assert "sibling awaitables may keep running" in expectations
    assert "failure observation explicit" in expectations
    assert "admission, backpressure, or shutdown behavior explicit" in expectations
    assert (
        "correct mechanism when completion must survive shutdown or crash"
        in expectations
    )
    assert "task references, failure observation, and an admission" not in expectations


def test_eval_8_splits_taskgroup_start_failure_modes_correctly() -> None:
    evals_path = SKILL_ROOT / "evals" / "evals.json"
    payload = json.loads(evals_path.read_text(encoding="utf-8"))
    eval_8 = next(item for item in payload["evals"] if item["id"] == 8)
    expectations = "\n".join(eval_8["expectations"])

    assert "exits without calling `task_status.started()`" in expectations
    assert (
        "keeps running without calling `task_status.started()`" in expectations
        or "waits until cancelled" in expectations
    )
    assert "if the child never signals readiness" not in expectations


def test_python_async_trigger_evals_cover_trigger_and_near_miss_cases() -> None:
    trigger_path = SKILL_ROOT / "evals" / "trigger-evals.json"
    payload = json.loads(trigger_path.read_text(encoding="utf-8"))

    assert len(payload) >= 16

    should_trigger = [item for item in payload if item["should_trigger"] is True]
    should_not_trigger = [item for item in payload if item["should_trigger"] is False]

    assert len(should_trigger) >= 8
    assert len(should_not_trigger) >= 8
    assert all(item["query"].strip() for item in payload)

    positive_queries = "\n".join(item["query"] for item in should_trigger)
    negative_queries = "\n".join(item["query"] for item in should_not_trigger)

    assert "AnyIO" in positive_queries or "asyncio" in positive_queries
    assert "Trio" in positive_queries or "uvloop" in positive_queries
    assert "FastAPI" in negative_queries or "Celery" in negative_queries
    assert "gevent" in negative_queries or "eventlet" in negative_queries
