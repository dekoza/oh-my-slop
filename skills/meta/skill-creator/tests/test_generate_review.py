from __future__ import annotations

import importlib.util
import json
from pathlib import Path


MODULE_PATH = Path(__file__).resolve().parents[1] / "eval-viewer" / "generate_review.py"
MODULE_SPEC = importlib.util.spec_from_file_location("skill_creator_generate_review", MODULE_PATH)
assert MODULE_SPEC is not None
assert MODULE_SPEC.loader is not None
generate_review = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(generate_review)


def test_find_runs_reads_metadata_from_eval_directory(tmp_path: Path) -> None:
    eval_directory = tmp_path / "eval-1-invoice-deduplication"
    run_directory = eval_directory / "with_skill" / "run-1"
    outputs_directory = run_directory / "outputs"
    outputs_directory.mkdir(parents=True)
    (outputs_directory / "summary.md").write_text("One duplicate group")
    (eval_directory / "eval_metadata.json").write_text(
        json.dumps(
            {
                "eval_id": 1,
                "eval_name": "invoice-deduplication",
                "prompt": "Review the vendor invoices.",
            }
        )
    )

    runs = generate_review.find_runs(tmp_path)

    assert len(runs) == 1
    assert runs[0]["eval_id"] == 1
    assert runs[0]["prompt"] == "Review the vendor invoices."
