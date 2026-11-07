#!/usr/bin/env python3
"""Re-pin one aq-server protocol contract into contracts/pinned.

Usage: scripts/pin-contract.py <aq-server-dir> <contract> <commit>

Replaces contracts/pinned/<contract>/v1/ with protocol/<contract>/v1/ as of
<commit>, then rewrites the sha256 entries and commits recorded in
contracts/pinned/source.json and contracts/pinned/<contract>/source.json.
"""
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
import tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
PINNED = ROOT / "contracts" / "pinned"


def main() -> int:
    if len(sys.argv) != 4:
        print(__doc__, file=sys.stderr)
        return 2
    server, contract, commit = pathlib.Path(sys.argv[1]), sys.argv[2], sys.argv[3]
    prefix = f"{contract}/v1/"
    with tempfile.TemporaryDirectory() as tmp:
        archive = subprocess.run(
            ["git", "-C", str(server), "archive", commit, f"protocol/{contract}/v1"],
            check=True, stdout=subprocess.PIPE,
        ).stdout
        subprocess.run(["tar", "-x", "-C", tmp], input=archive, check=True)
        source = pathlib.Path(tmp) / "protocol" / contract / "v1"
        target = PINNED / contract / "v1"
        if target.exists():
            shutil.rmtree(target)
        shutil.copytree(source, target)
    digests = {
        prefix + path.relative_to(target).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(target.rglob("*")) if path.is_file()
    }

    def rewrite(path: pathlib.Path, update) -> None:
        doc = json.loads(path.read_text())
        doc["sha256"] = {k: v for k, v in doc["sha256"].items() if not k.startswith(prefix)}
        doc["sha256"].update(digests)
        doc["sha256"] = dict(sorted(doc["sha256"].items()))
        update(doc)
        path.write_text(json.dumps(doc, indent=2) + "\n")

    def root(doc):
        doc.setdefault("contract_commits", {})[contract] = commit

    def per_contract(doc):
        doc["commit"] = commit

    rewrite(PINNED / "source.json", root)
    rewrite(PINNED / contract / "source.json", per_contract)
    print(f"pinned {contract} at {commit}: {len(digests)} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
