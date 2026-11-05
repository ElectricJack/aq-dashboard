#!/usr/bin/env python3
"""Run the unmodified server fixture checker in its expected protocol layout."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
root = Path(__file__).resolve().parents[1]
with tempfile.TemporaryDirectory(prefix='g3-contracts-') as directory:
    protocol = Path(directory)
    shutil.copytree(root / 'contracts/live/dashboard-actions', protocol / 'dashboard-actions/v1')
    read = protocol / 'dashboard-read/v1'
    read.mkdir(parents=True)
    shutil.copyfile(root / 'contracts/live/dashboard-read-g2/schema.json', read / 'schema.json')
    subprocess.run(['python3', str(protocol / 'dashboard-actions/v1/check.py')], check=True)
for name in ('dashboard-actions', 'human-graph'):
    source = json.loads((root / 'contracts/live' / name / 'source.json').read_text())
    for path, digest in source['files'].items():
        assert hashlib.sha256((root / 'contracts/live' / name / path).read_bytes()).hexdigest() == digest, path
read_source = json.loads((root / 'contracts/live/dashboard-read-g2/source.json').read_text())
assert hashlib.sha256((root / 'contracts/live/dashboard-read-g2/schema.json').read_bytes()).hexdigest() == read_source['sha256']
for path, digest in read_source['fixtures'].items():
    assert hashlib.sha256((root / 'contracts/live/dashboard-read-g2' / path).read_bytes()).hexdigest() == digest, path
print('G3 pinned fixture source hashes passed')
