---
title: Keep worker actions reachable without scrolling past the launcher
author: Jack
date: 2026-11-18
branch: feat/worker-inspector
cost: { minutes: 7, tokens: 49452 }
id: l-373c6ae7
scope: repo
status: active
src: agent
touches:
  - src/features/agents/swarm/WorkerLaunch.tsx
  - src/features/agents/swarm/SwarmPage.tsx
---

## Decided

Use the shared worker inspector in Tree and Board, with Overview, Settings, Logins and Diagnostics in the same tab row. Keep the panels mounted for the selected worker so an unfinished edit or a pending request survives switching tabs or views. Reset the inspector when the selected worker changes.

## Tried and ruled out

Sections collapsed beneath the launcher kept the empty view short. In a populated desktop preview they still fell below the inspector fold, and the bottom section at 320px was covered by phone navigation during selection. The tab row stays above the desktop scroll area and is visible when the phone brings the selected worker into view.

## Watch out

A worker has a reported slot total for the worker as a whole. The manual fleet also supplies scoped project allocation and drain information. Show the latter with its project scope so it does not look like a change to the worker's overall slot capacity.

In the code:
- `WorkerInspector.tsx` uses the same worker standing and busy count helpers as Tree and Board. `WorkerLaunch.tsx` keeps the existing project allocation controls.
- `SwarmPage.tsx` preserves selection when changing views and restores focus to the originating control when the worker inspector closes.
