"""Run the dashboard's native frontend checks under aq's test slot."""
import os
import shlex
import subprocess
from pathlib import Path


def test_frontend_command():
    command = shlex.split(os.environ['DASHBOARD_CHECK_COMMAND'])
    log = Path(os.environ['DASHBOARD_CHECK_LOG'])
    with log.open('w') as output:
        result = subprocess.run(command, cwd=os.environ['AQ_WORK_DIR'], stdout=output, stderr=subprocess.STDOUT, check=False)
    assert result.returncode == 0, f'{command} exited {result.returncode}; see {log}'
