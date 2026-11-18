---
title: Use unfinished dependencies to lay out live work tracks
author: Jack
date: 2026-11-18
branch: feat/live-dependency-gantt
cost: { minutes: 29, tokens: 3553 }
id: l-50791528
scope: repo
status: active
src: agent
---

## Decided

A dependency Gantt represents the work that remains. Each bar is one task and its horizontal position is the depth of its longest unfinished prerequisite chain. That lets a completed prerequisite disappear and downstream work slide left without suggesting calendar dates or durations. A dependent with several prerequisites still needs one bar, with a connector from each prerequisite.

## Tried and ruled out

A one-hop view around the selected task stops partway through a chain and misses independent running work. Treating hierarchy and references as dependencies would invent execution constraints.

## Watch out

Execution holders and dependency edges come from different reads. Reconcile lifecycle by task version and mark incomplete coverage because bounded neighborhoods can omit edges. Leave readiness to AQ's work read. An all-project view should bound its relationship reads to leave capacity for the task inspector.

In the code: task list pages supply execution holders. Neighborhoods supply the `blocks` edges, whose source is the prerequisite. Preserve orientation against a surviving bar when the grid reflows under a panned viewport.
