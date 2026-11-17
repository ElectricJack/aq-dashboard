---
title: Keep saved agent history readable without replaying the terminal
author: Jack
date: 2026-11-17
branch: fix/agents-history-rendering
cost: { minutes: 29, tokens: 87367 }
id: l-866b5b8a
scope: repo
status: active
src: agent
touches:
  - src/features/agents/history/History.tsx
  - src/features/agents/history/compactTranscript.ts
  - src/features/agents/history/History.test.tsx
---

## Decided

Keep History as a readable, chronological view of the existing plain-text archive. Fold standalone terminal redraw debris, leading block artwork and repeated blank lines in the display, with a full-output control. This helps existing recordings without weakening the archive's control stripping or changing copy, export, or literal search.

## Tried and ruled out

Replaying the archive with a terminal renderer cannot recover the original screen. A read-only check of live Claude and Codex archives found glyph fragments and excessive blank lines already in the stored text, with no cursor escape bytes. The worker discards terminal control and cursor information before upload. CSS alone cannot remove the resulting fragments or recover the screen.

## Watch out

Search positions are UTF-8 byte offsets into the original archive. Convert offsets against the original page before compacting its display, and reveal a matched line if it would ordinarily be folded. Preserve the text on mixed lines since apparent repeats and punctuation can be meaningful. Older records can still contain repeated or joined text where the producer flattened cursor movements.

In the code:
- The producer is in aq-worker's `crates/aq-worker/src/bin/aq-worker/manual/recording.rs`.
- The display compaction is in `src/features/agents/history/compactTranscript.ts`; `History.tsx` applies it only to the rendered page.
