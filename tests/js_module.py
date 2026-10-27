"""Run the UI's pure ES modules (served by the app) in node, for UI decision tests."""
import json
import shutil
import subprocess

import pytest

needs_node = pytest.mark.skipif(shutil.which("node") is None, reason="needs node to run the UI module")


def run_module(source: str, expression: str):
    """Evaluate ``expression`` against the ES module ``source`` in node; return its JSON value."""
    script = (f"const m = await import('data:text/javascript,' + encodeURIComponent({json.dumps(source)}));"
              f"console.log(JSON.stringify({expression}));")
    out = subprocess.run(["node", "--input-type=module", "-e", script],
                         capture_output=True, text=True, check=True, timeout=30)
    return json.loads(out.stdout)
