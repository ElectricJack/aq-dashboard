"""Verify downloaded release assets against an independently pinned SHA-256.

python docs/implementation/evidence/E3/verify-release.py DOWNLOAD_DIR ARCHIVE_SHA256
"""
import hashlib
import json
import sys
import tarfile
from pathlib import Path

root = Path(sys.argv[1])
expected = sys.argv[2]
name = "aq-dashboard-v0.1.0.tar.gz"
record = json.loads((root / (name + ".release.json")).read_text())
archive_digest = hashlib.sha256((root / name).read_bytes()).hexdigest()
assert archive_digest == expected == record["archive_sha256"]
assert (root / (name + ".sha256")).read_text() == f"{expected}  {name}\n"
with tarfile.open(root / name, "r:gz") as tar:
    manifest_bytes = tar.extractfile("dashboard-manifest.json").read()
    assert "sha256:" + hashlib.sha256(manifest_bytes).hexdigest() == record["dashboard_digest"]
    manifest = json.loads(manifest_bytes)
    assert manifest["schema_version"] == record["manifest_schema_version"] == 2
    assert record["tag"] == "v" + manifest["version"] == "v0.1.0"
    assert manifest["source"] == {"revision": record["source_revision"], "dirty": False, "official": True}
    assert set(tar.getnames()) == set(manifest["files"]) | {"dashboard-manifest.json"}
    for name, entry in manifest["files"].items():
        member = tar.getmember(name)
        assert member.isfile()
        data = tar.extractfile(member).read()
        assert len(data) == entry["bytes"]
        assert hashlib.sha256(data).hexdigest() == entry["sha256"]
print(json.dumps({"release": record["tag"], "source_revision": record["source_revision"],
                  "archive_sha256": archive_digest, "dashboard_digest": record["dashboard_digest"],
                  "verified_files": len(manifest["files"]), "downloaded_assets_verified": True}, indent=2))
