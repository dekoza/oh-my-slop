from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
NODE_TEST = REPO_ROOT / "tests" / "node" / "provider_failover_core.test.mjs"


def test_provider_failover_node_suite() -> None:
    result = subprocess.run(
        ["node", "--test", str(NODE_TEST)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )

    if result.returncode != 0:
        raise AssertionError(
            "Node failover extension tests failed\n"
            f"STDOUT:\n{result.stdout}\n"
            f"STDERR:\n{result.stderr}"
        )
