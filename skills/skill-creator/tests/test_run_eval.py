import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import run_eval


class FindProjectRootTests(unittest.TestCase):
    def test_prefers_opencode_directory(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            nested = root / "a" / "b"
            nested.mkdir(parents=True)
            (root / ".opencode").mkdir()

            with mock.patch("scripts.run_eval.Path.cwd", return_value=nested):
                result = run_eval.find_project_root()

        self.assertEqual(result, root)


class DetectSkillTriggerTests(unittest.TestCase):
    def test_detects_skill_tool_use_event(self) -> None:
        events = [
            json.dumps({"type": "step_start"}),
            json.dumps(
                {
                    "type": "tool_use",
                    "part": {
                        "tool": "skill",
                        "state": {
                            "input": {
                                "name": "litestar",
                            }
                        },
                    },
                }
            ),
            json.dumps({"type": "step_finish"}),
        ]

        self.assertTrue(run_eval.detect_skill_trigger(events, "litestar"))


class RunSingleQueryRetryTests(unittest.TestCase):
    @mock.patch("scripts.run_eval.subprocess.run")
    def test_retries_timeout_before_succeeding(
        self, mock_subprocess_run: mock.Mock
    ) -> None:
        mock_subprocess_run.side_effect = [
            subprocess.TimeoutExpired(cmd=["opencode"], timeout=30),
            mock.Mock(
                stdout=json.dumps(
                    {
                        "type": "tool_use",
                        "part": {
                            "tool": "skill",
                            "state": {"input": {"name": "litestar"}},
                        },
                    }
                )
                + "\n"
            ),
        ]

        result = run_eval.run_single_query(
            query="review this litestar API design",
            skill_name="litestar",
            skill_description="Use when reviewing Litestar work.",
            timeout=30,
            project_root="/tmp/project",
            model="github-copilot/gpt-5.4",
            max_attempts_per_run=2,
        )

        self.assertTrue(result)
        self.assertEqual(mock_subprocess_run.call_count, 2)

    @mock.patch("scripts.run_eval.subprocess.run")
    def test_returns_false_after_exhausting_timeout_retries(
        self, mock_subprocess_run: mock.Mock
    ) -> None:
        mock_subprocess_run.side_effect = [
            subprocess.TimeoutExpired(cmd=["opencode"], timeout=30),
            subprocess.TimeoutExpired(cmd=["opencode"], timeout=30),
        ]

        result = run_eval.run_single_query(
            query="review this litestar API design",
            skill_name="litestar",
            skill_description="Use when reviewing Litestar work.",
            timeout=30,
            project_root="/tmp/project",
            model="github-copilot/gpt-5.4",
            max_attempts_per_run=2,
        )

        self.assertFalse(result)
        self.assertEqual(mock_subprocess_run.call_count, 2)


class ClassifyEventTests(unittest.TestCase):
    def test_returns_true_for_matching_skill_tool_use(self) -> None:
        line = json.dumps(
            {
                "type": "tool_use",
                "part": {
                    "tool": "skill",
                    "state": {
                        "input": {
                            "name": "litestar",
                        }
                    },
                },
            }
        )

        self.assertTrue(run_eval.classify_event(line, "litestar"))

    def test_returns_false_for_step_finish_without_skill(self) -> None:
        line = json.dumps({"type": "step_finish"})

        self.assertFalse(run_eval.classify_event(line, "litestar"))

    def test_returns_none_for_irrelevant_event(self) -> None:
        line = json.dumps({"type": "text", "part": {"text": "hello"}})

        self.assertIsNone(run_eval.classify_event(line, "litestar"))

    def test_returns_false_for_other_skill(self) -> None:
        events = [
            json.dumps(
                {
                    "type": "tool_use",
                    "part": {
                        "tool": "skill",
                        "state": {
                            "input": {
                                "name": "django",
                            }
                        },
                    },
                }
            )
        ]

        self.assertFalse(run_eval.detect_skill_trigger(events, "litestar"))

    def test_ignores_invalid_json_lines(self) -> None:
        events = [
            "not-json",
            json.dumps(
                {
                    "type": "tool_use",
                    "part": {
                        "tool": "skill",
                        "state": {
                            "input": {
                                "name": "litestar",
                            }
                        },
                    },
                }
            ),
        ]

        self.assertTrue(run_eval.detect_skill_trigger(events, "litestar"))


if __name__ == "__main__":
    unittest.main()
