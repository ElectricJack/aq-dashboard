# Dashboard release archive implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task in the assigned worktree. Steps use checkbox syntax for tracking.

**Goal:** Publish v0.1.0 with reproducible packaging, schema 2 provenance and compatibility metadata, and independently verifiable archive and manifest digests.

**Architecture:** Keep the static bundle manifest inside dist; place the archive digest and release record beside the archive to avoid self-reference. Official generation checks clean Git provenance and matching package/tag versions. Release CI runs checks before publishing all three assets.

**Tech Stack:** Node 24, pnpm 10.34.5, Vitest, GNU tar/gzip, GitHub Actions and gh.

**Spec:** Task smart-falcon-16.6 (E3), docs/specs/0001-dashboard.md §6 and aq-server ecosystem §4.

## Global Constraints

- **Builds:** each repository builds and tests alone. No sibling path dependencies, no submodules, no floating branches in release inputs.
- **Secrets:** no secrets in templates, manifests, prompts, logs, assignment JSON or task descriptions.
- **Explicit refusals:** unsupported required capabilities refuse explicitly; nothing silently degrades.
- For aq-dashboard: `pnpm lint`, `pnpm typecheck` and `pnpm test`.
- Evidence goes in `docs/implementation/E3.md`, recording exact commands, environment, commit and remaining limits.
- Changes are pushed through the project's integration policy; do not publish the default branch.
- No UI changes, server loader edits, browser digest logic, or product manifest format changes.

### Task 1: Versioned manifest and release assets

**Files:** Modify `scripts/bundle-manifest.mjs` and `package.json`; create `scripts/release-archive.mjs`, `scripts/lint.mjs`, `src/test/bundleManifest.test.ts`, `.github/workflows/release.yml`, `docs/implementation/E3.md`.

**Interfaces:** Manifest schema 2 retains `api_version` and `files`, adds `version`, `source: {revision, dirty, official}`, `toolchain: {node, pnpm, lockfile_sha256}`, `required_api_versions: string[]`, `required_capabilities: string[]`. Release record schema 1 carries tag, source revision, asset URL, archive SHA-256 and `dashboard_digest` as `sha256:<manifest hash>`. No archive digest inside manifest.

- [ ] Write a Node-environment Vitest test using a temporary Git fixture, real lockfile bytes and minimal dist assets. Run both scripts as child processes. Assert schema 2, full SHA, toolchain/lockfile hash, API version, `results.media.read` and `playbooks.inspect`, exact file hashes, sidecar, and manifest digest. Compare two archives after changing file times. Add cases for dirty official sources and mismatched tag versions.

```ts
expect(manifest.schema_version).toBe(2);
expect(manifest.required_capabilities).toEqual(expect.arrayContaining(['results.media.read', 'playbooks.inspect']));
expect(record.dashboard_digest).toBe(`sha256:${hash(manifestBytes)}`);
expect(hash(archiveBytes)).toBe(record.archive_sha256);
```

- [ ] Install with `pnpm install --frozen-lockfile`; run `pnpm test -- -t bundle_manifest_lists_required_capabilities_and_digest` and record the expected schema 1 failure before implementation.
- [ ] Extend manifest generation with Git clean-tree enforcement for `--official`, source SHA, actual Node/pnpm versions and lockfile digest. Keep sorted file entries and existing size/asset limits. Set version to 0.1.0.
- [ ] Implement archive CLI `node scripts/release-archive.mjs dist <output-dir> v0.1.0 <owner/repo>`. Verify official source/tag/manifest and file digests; reject undeclared paths. Use GNU tar sorted names, epoch timestamps, numeric zero ownership and gzip `-n`, then write `.sha256` and `.release.json` externally.
- [ ] Add dependency-free Node syntax lint for repository scripts. Add tag workflow with frozen install, lint, typecheck, test, official build, packaging and `gh release create --verify-tag`; use job-scoped contents write permission.
- [ ] Run focused tests and full required frontend checks, recording exact results. Rebuild officially from a clean committed tree and verify deterministic archives and sidecars.
- [ ] Commit implementation, squash own unpublished feature history, merge `origin/dev`, rerun focused checks and publish with guarded `aq git push`.
- [ ] Publish v0.1.0 from the pushed immutable source commit with `gh release create --target <full SHA>` and upload archive, sidecar and record. Download all assets independently and verify their hashes and archive content. Record tag/URL/digests and release source commit in evidence. Commit and push evidence, settle subtasks, explicitly close and drain-ack.

Self-review: all E3 requirements map to these steps. The required server loader migration remains with E1b. E3 is not marked adversarial. Publication is explicitly authorized by this task.
