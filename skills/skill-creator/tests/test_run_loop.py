import tempfile
import unittest
from pathlib import Path
from unittest import mock

from scripts import run_loop


def _result(query: str, should_trigger: bool, passed: bool) -> dict:
    if should_trigger:
        triggers = 1 if passed else 0
    else:
        triggers = 0 if passed else 1

    return {
        "query": query,
        "should_trigger": should_trigger,
        "trigger_rate": float(triggers),
        "triggers": triggers,
        "runs": 1,
        "pass": passed,
    }


class RunLoopStoppingTests(unittest.TestCase):
    @mock.patch("scripts.run_loop.improve_description")
    @mock.patch("scripts.run_loop.run_eval")
    @mock.patch("scripts.run_loop.split_eval_set")
    @mock.patch("scripts.run_loop.find_project_root")
    @mock.patch("scripts.run_loop.parse_skill_md")
    def test_continues_when_holdout_exists_and_only_train_passes(
        self,
        mock_parse_skill_md: mock.Mock,
        mock_find_project_root: mock.Mock,
        mock_split_eval_set: mock.Mock,
        mock_run_eval: mock.Mock,
        mock_improve_description: mock.Mock,
    ) -> None:
        train_set = [
            {"query": "train-positive", "should_trigger": True},
            {"query": "train-negative", "should_trigger": False},
        ]
        test_set = [
            {"query": "test-positive", "should_trigger": True},
            {"query": "test-negative", "should_trigger": False},
        ]

        mock_parse_skill_md.return_value = (
            "litestar",
            "original description",
            "skill content",
        )
        mock_find_project_root.return_value = Path("/tmp/project")
        mock_split_eval_set.return_value = (train_set, test_set)
        mock_run_eval.side_effect = [
            {
                "results": [
                    _result("train-positive", True, True),
                    _result("train-negative", False, True),
                    _result("test-positive", True, False),
                    _result("test-negative", False, True),
                ]
            },
            {
                "results": [
                    _result("train-positive", True, True),
                    _result("train-negative", False, True),
                    _result("test-positive", True, True),
                    _result("test-negative", False, True),
                ]
            },
        ]
        mock_improve_description.return_value = "improved description"

        result = run_loop.run_loop(
            eval_set=train_set + test_set,
            skill_path=Path("/tmp/litestar"),
            description_override=None,
            num_workers=1,
            timeout=30,
            max_iterations=2,
            runs_per_query=1,
            max_attempts_per_run=2,
            trigger_threshold=0.5,
            holdout=0.4,
            model="github-copilot/gpt-5.4",
            verbose=False,
        )

        self.assertEqual(result["iterations_run"], 2)
        self.assertEqual(result["best_description"], "improved description")
        self.assertEqual(mock_run_eval.call_count, 2)
        self.assertTrue(
            all(
                call.kwargs["max_attempts_per_run"] == 2
                for call in mock_run_eval.call_args_list
            )
        )
        mock_improve_description.assert_called_once()

    @mock.patch("scripts.run_loop.improve_description")
    @mock.patch("scripts.run_loop.run_eval")
    @mock.patch("scripts.run_loop.find_project_root")
    @mock.patch("scripts.run_loop.parse_skill_md")
    def test_stops_immediately_without_holdout_when_train_passes(
        self,
        mock_parse_skill_md: mock.Mock,
        mock_find_project_root: mock.Mock,
        mock_run_eval: mock.Mock,
        mock_improve_description: mock.Mock,
    ) -> None:
        eval_set = [
            {"query": "train-positive", "should_trigger": True},
            {"query": "train-negative", "should_trigger": False},
        ]

        mock_parse_skill_md.return_value = (
            "litestar",
            "original description",
            "skill content",
        )
        mock_find_project_root.return_value = Path("/tmp/project")
        mock_run_eval.return_value = {
            "results": [
                _result("train-positive", True, True),
                _result("train-negative", False, True),
            ]
        }

        result = run_loop.run_loop(
            eval_set=eval_set,
            skill_path=Path("/tmp/litestar"),
            description_override=None,
            num_workers=1,
            timeout=30,
            max_iterations=3,
            runs_per_query=1,
            max_attempts_per_run=2,
            trigger_threshold=0.5,
            holdout=0,
            model="github-copilot/gpt-5.4",
            verbose=False,
        )

        self.assertEqual(result["iterations_run"], 1)
        self.assertEqual(mock_run_eval.call_count, 1)
        self.assertEqual(mock_run_eval.call_args.kwargs["max_attempts_per_run"], 2)
        mock_improve_description.assert_not_called()


if __name__ == "__main__":
    unittest.main()
