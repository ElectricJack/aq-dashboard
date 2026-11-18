---
title: Read the conversation from provider messages when available
author: Jack
date: 2026-11-17
branch: feat/native-agent-history
cost: { minutes: 30, tokens: 127639 }
id: l-6c13c99d
scope: repo
status: active
src: agent
touches:
  - src/features/agents/history/History.tsx
  - src/features/agents/history/Conversation.tsx
  - src/api/sessionConversation.ts
---

## Decided

Agents History opens native user and assistant text when it exists. The first rollout kept the terminal archive as a fallback. The owner later removed it because the retained terminal text was unreadable. Take one durable conversation snapshot after stop, when the native log is stable, and collect it from retained stopped sandboxes as well. This makes capture independent of browser connections and avoids overwriting archived content on retry.

## Tried and ruled out

Current Codex interactive rollouts in AQ did not reliably emit a separate user-message event. Inspecting local records showed that response-item messages carry the real conversation, but can also label the injected project instructions and environment context as user text. Filter those synthetic blocks in the worker. Terminal text cannot substitute for these records because the archive had already dropped cursor motions before the browser saw it.

## Watch out

Read only the known provider directories using the original sandbox identity. One root log is expected per manual sandbox and ambiguous sources are unsafe to merge. Native payloads can contain reasoning, tool results or system context. Archive only user and assistant text, apply the existing credential masking, and keep the raw log private. Older server and worker versions may have terminal history only.

In the code:
- The dashboard chooses between sources in `src/features/agents/history/History.tsx` and checks the session and project in `src/api/sessionConversation.ts`.
- The worker's manual conversation collector is in `crates/aq-worker/src/bin/aq-worker/manual/conversation.rs`.
- Server conversation routes and storage are in `crates/aq-manual-sessions/src/conversation.rs` and server migration 138. The concurrent supervisor update took migration 137, so History was restacked after it to keep fresh installs and upgrades on the same migration sequence.
