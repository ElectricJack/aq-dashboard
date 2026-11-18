---
title: Keep saved agent history limited to provider conversations
author: Jack
date: 2026-11-18
branch: fix/remove-terminal-history
cost: { minutes: 14, tokens: 49452 }
id: l-aac10dc2
scope: repo
status: active
src: agent
touches:
  - src/features/agents/history/History.tsx
  - src/features/agents/terminals/TerminalWorkspace.tsx
  - src/api/sessionHistory.ts
---

## Decided

Agents History uses saved provider conversations. The owner asked to remove the unreadable terminal transcript including its recorder, API, UI and storage, so unavailable conversations have a plain empty state.

## Tried and ruled out

The terminal text had already lost its cursor movement information on capture. Display cleanup could not restore messages, and a terminal transcript tab beside the native conversation still exposed the distorted output.

## Watch out

Keep live terminal connection and input separate from historical storage. Pinned panes need session metadata after the session leaves the active roster, so use the session detail endpoint. A forward migration removes the archive tables while preserving provider conversations and the previous migration sequence.

In the code:
- The History reader is in `src/features/agents/history/History.tsx`.
- The terminal workspace gets session metadata through `src/features/agents/terminals/TerminalWorkspace.tsx` and `src/api/sessionHistory.ts`.
