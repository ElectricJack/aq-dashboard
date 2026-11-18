---
title: Use unfinished dependencies to lay out live work tracks
author: Jack
date: 2026-11-18
branch: feat/live-dependency-gantt
cost: { minutes: 57, tokens: 58498 }
id: l-50791528
scope: repo
status: active
src: agent
touches:
  - src/features/work/gantt/ganttLayout.ts
  - src/features/work/gantt/GanttCanvas.tsx
---

## Decided
A dependency Gantt represents the work that remains. Each bar is one task and its horizontal position is the depth of its longest unfinished prerequisite chain. That lets a completed prerequisite disappear and downstream work slide left without suggesting calendar dates or durations. A dependent with several prerequisites still needs one bar, with a connector from each prerequisite.
Pin task titles on the left and draw one rounded bar per task on the right. Order the tasks in each track by dependency step so siblings stay together and shared dependents appear below their prerequisites. A fork from one source can share a trunk because the following arrows still lead to distinct tasks.

## Tried and ruled out
A one-hop view around the selected task stops partway through a chain and misses independent running work. Treating hierarchy and references as dependencies would invent execution constraints.
The first draft arranged task cards as spreadsheet cells, with the main dependency chain sharing a row. The owner pointed to a Gantt with separate task labels and bars. Sharing rows concealed the shape of branches. A depth-first row order also put a shared dependent between its two prerequisites in the preview and sent one connector upward.

## Watch out
Execution holders and dependency edges come from different reads. Reconcile lifecycle by task version and mark incomplete coverage because bounded neighborhoods can omit edges. Leave readiness to AQ's work read. An all-project view should bound its relationship reads to leave capacity for the task inspector.

In the code: task list pages supply execution holders. Neighborhoods supply the `blocks` edges, whose source is the prerequisite. Preserve orientation against a surviving bar when the grid reflows under a panned viewport.
Horizontal position describes depth through unfinished prerequisites. Keep bar lengths independent of estimated duration and keep task labels legible during zoom. Overlapping connector spans from different sources need separate routes to avoid suggesting a common prerequisite.

In the code: position each dependent on the latest track of any prerequisite, and route elbows through the gaps between steps.
