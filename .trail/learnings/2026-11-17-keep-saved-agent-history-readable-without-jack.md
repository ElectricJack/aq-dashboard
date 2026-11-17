---
title: Use native provider messages for readable agent history
author: Jack
date: 2026-11-17
branch: fix/agents-history-rendering
cost: { minutes: 57, tokens: 237781 }
id: l-866b5b8a
scope: repo
status: active
src: agent
touches:
  - src/features/agents/history/History.tsx
  - src/features/agents/history/compactTranscript.ts
  - src/features/agents/history/History.test.tsx
  - src/app/Shell.test.tsx
  - src/app/Shell.tsx
  - src/app/destinations.ts
  - tests/shell.spec.ts
  - tests/visual/tablet.spec.ts
  - src/api/sessionHistory.ts
---

## Decided

The owner judged the terminal cleanup insufficient because the message text itself remains distorted. Use the providers' native messages as the candidate source for a readable conversation history. Keep PTY output available for terminal-specific diagnostics.

## Tried and ruled out

Filtering border glyphs and whitespace still leaves words joined by cursor motions that were discarded at capture time. The regular Docker context made the sampled sandboxes appear missing. Querying the worker's configured Podman socket confirmed that some stopped manual sandboxes retain native JSONL with both user and assistant text.

## Watch out

An existing sandbox is not proof that it has session messages. Backfill requires the original sandbox and usable provider records. The native observation normalizer emits text references with digests, so it is evidence of schema support rather than a ready-made content archive. Any ingestion should bind the discovered file to the AQ session, parse only the necessary message fields, and avoid sending credential files or raw provider dumps to the dashboard.

In the code:
- Manual provider startup sets the sandbox home in aq-worker's `crates/aq-worker/src/bin/aq-worker/manual/provider.rs`.
- Claude Code's native records were found under `/aq/home/.claude/projects/`; Codex's were under `/aq/home/.codex/sessions/`.
- Existing terminal retention uses `crates/aq-worker/src/bin/aq-worker/manual/recording.rs`. The file-based observation formats are in `crates/aq-observation-engine/src/formats/`.
- The current dashboard reader in `src/features/agents/history/History.tsx` calls the plain-text archive through `src/api/sessionHistory.ts`. The display-only experiment in `src/features/agents/history/compactTranscript.ts` does not address the reported distortion.
