from __future__ import annotations

import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
NODE_TEST_GLOB = "tests/node/*.mjs"


def test_provider_failover_node_suite() -> None:
    result = subprocess.run(
        ["bash", "-lc", f"node --test {NODE_TEST_GLOB}"],
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
