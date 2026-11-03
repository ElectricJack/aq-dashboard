"""Five full suites sharing two CPUs with one busy process, under aq test."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

root = Path(os.environ['AQ_WORK_DIR'])
output = Path('/tmp/azure-harbor-91')
cpus = sorted(os.sched_getaffinity(0))[:2]
os.sched_setaffinity(0, cpus)
tracked = subprocess.check_output(['git', 'ls-files', 'src', 'scripts', 'vite.config.ts', 'pnpm-lock.yaml', 'package.json'], cwd=root, text=True).splitlines()
report = {
    'command': ['pnpm', 'test'],
    'requested_repetitions': 5,
    'maxWorkers': 2,
    'cpu_affinity': cpus,
    'load': 'One continuous CPU-bound Python process sharing the same affinity as each suite',
    'source_sha256': {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in tracked},
    'runs': [],
}
load = subprocess.Popen([sys.executable, '-c', 'while True: sum(range(10000))'])
try:
    for repetition in range(1, 6):
        log = output / f'run-{repetition:02}.log'
        start = time.monotonic()
        with log.open('w') as stream:
            result = subprocess.run(report['command'], cwd=root, stdout=stream, stderr=subprocess.STDOUT, check=False)
        clean = re.sub(r'\x1b\[[0-9;]*m', '', log.read_text())
        summary = [line.strip() for line in clean.splitlines() if re.match(r'\s*(Test Files|Tests |Duration )', line)]
        report['runs'].append({
            'repetition': repetition,
            'exit_code': result.returncode,
            'duration_seconds': round(time.monotonic() - start, 2),
            'log': log.name,
            'log_sha256': hashlib.sha256(log.read_bytes()).hexdigest(),
            'unhandled_msw_errors': clean.count('[MSW] Error:'),
            'summary': summary,
        })
        (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
        print(f"Run {repetition}/5: exit {result.returncode}; {'; '.join(summary)}; MSW errors={report['runs'][-1]['unhandled_msw_errors']}", flush=True)
        if result.returncode or report['runs'][-1]['unhandled_msw_errors']:
            raise SystemExit(result.returncode or 1)
    assert all(hashlib.sha256((root / name).read_bytes()).hexdigest() == digest for name, digest in report['source_sha256'].items())
finally:
    load.terminate()
    _, status, usage = os.wait4(load.pid, 0)
    report['load_cpu_seconds'] = round(usage.ru_utime + usage.ru_stime, 2)
    report['load_exit_status'] = status
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
