"""Repeat full-suite or focused qualification sequentially under the AQ bridge."""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import time


root = Path(os.environ["AQ_WORK_DIR"])
output = Path(os.environ["DASHBOARD_REPETITION_DIR"])
output.mkdir(parents=True, exist_ok=True)
tracked = subprocess.check_output(["git", "ls-files", "src", "scripts", "vite.config.ts", "pnpm-lock.yaml", "package.json"], cwd=root, text=True).splitlines()
report = {
    "command": shlex.split(os.environ.get("DASHBOARD_REPETITION_COMMAND", "pnpm test")),
    "requested_repetitions": 20,
    "maxWorkers": 2,
    "source_sha256": {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in tracked},
    "runs": [],
}
for repetition in range(1, 21):
    log = output / f"run-{repetition:02}.log"
    start = time.monotonic()
    with log.open("w") as stream:
        result = subprocess.run(report["command"], cwd=root, stdout=stream, stderr=subprocess.STDOUT, check=False)
    clean = re.sub(r"\x1b\[[0-9;]*m", "", log.read_text())
    summary = [line.strip() for line in clean.splitlines() if re.match(r"\s*(Test Files|Tests |Duration )", line)]
    report["runs"].append({
        "repetition": repetition,
        "exit_code": result.returncode,
        "duration_seconds": round(time.monotonic() - start, 2),
        "log": log.name,
        "summary": summary,
    })
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(f"Run {repetition}/20: exit {result.returncode}; {'; '.join(summary)}", flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)
