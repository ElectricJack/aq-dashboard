---
title: Use unfinished dependencies to lay out live work tracks
author: Jack
date: 2026-11-18
branch: feat/live-dependency-gantt
cost: { minutes: 146, tokens: 270194 }
id: l-50791528
scope: repo
status: active
src: agent
touches:
  - src/features/work/gantt/ganttLayout.ts
  - src/features/work/gantt/GanttCanvas.tsx
  - src/features/overview/Overview.tsx
  - src/features/work/gantt/DependencyGantt.tsx
  - tests/supervisor-launcher.spec.ts
---

## Decided
A dependency Gantt represents the work that remains. Each bar is one task and its horizontal position follows the longest unfinished prerequisite chain. That lets a completed prerequisite disappear and downstream work slide left without suggesting calendar dates or durations. A dependent with several prerequisites still needs one bar, with a connector from each prerequisite.
Pin task titles on the left and draw one rounded bar per task on the right. Order the tasks in each track by dependency step so siblings stay together and shared dependents appear below their prerequisites. A fork from one source can share a trunk because the following arrows still lead to distinct tasks.
The owner asked for editable story points and a cumulative effort ruler. A task starts at the greatest finish point of its unfinished prerequisites. A fork can therefore run in parallel and a join advances after the longest remaining chain. Model an unestimated task with a dashed one-point placeholder and label the allowance on the chart, so old tasks stay visible and the placeholder is not mistaken for an estimate.
The owner approved the story-point Gantt and asked to remove its project activity summary and dependencies disclosures. The chart is the main place to scan project activity and understand dependency connections.
Overview owns its offline message when it retains its summary. An embedded chart still reports a failed online refresh, and a standalone Work chart reports its own offline state. Keep the story-point estimate beside the inspector status on narrow screens so it fits in the existing pinned header.

## Tried and ruled out
A one-hop view around the selected task stops partway through a chain and misses independent running work. Treating hierarchy and references as dependencies would invent execution constraints.
The first draft arranged task cards as spreadsheet cells, with the main dependency chain sharing a row. Sharing rows concealed the shape of branches. A depth-first row order also put a shared dependent between its two prerequisites in the preview and sent one connector upward.
Equal-width bars communicate order, but did not capture estimated effort. Adding estimates directly to the existing Graph metadata and updating them under the task revision uses the same durable record and concurrency guard as the other editable task fields.
The first version kept separate activity and dependency disclosures directly below the chart. The owner found those controls redundant with the task tracks and arrows.
The first integration rendered generic offline notices for the Overview, the chart's project picker, and the chart's tasks. It also made a full-width Gantt row anchor look occluded to the browser's geometry check, even though that row intentionally receives clicks only on the pinned label and task bar.

## Watch out
Execution holders and dependency edges come from different reads. Reconcile lifecycle by task version and mark incomplete coverage because bounded neighborhoods can omit edges. Leave readiness to AQ's work read. An all-project view should bound its relationship reads to leave capacity for the task inspector.

In the code: task list pages supply execution holders. Neighborhoods supply the `blocks` edges, whose source is the prerequisite. Preserve orientation against a surviving bar when the grid reflows under a panned viewport.
Horizontal position describes cumulative estimated effort through unfinished prerequisites. Keep task labels legible during zoom. Overlapping connector spans from different sources need separate routes to avoid suggesting a common prerequisite.

In the code: position each dependent on the latest track of any prerequisite, and route elbows through the gaps between steps.
An omitted edit field leaves an estimate intact. An explicit null clears it. Graph updates replace the entire metadata object, so start with the current object and preserve its other keys. Keep point widths independent of zoomed text. Wheel over the plot pans horizontally, while the task rail still supports vertical scrolling.

In the code: the server projects only `story_points` from `aq:story_points` without exposing the rest of the metadata. The ruler only renders the visible tick labels so large point totals do not create a large DOM tree.
Keep task names for both directions of a dependency available to screen readers through each task bar. On a server without Graph reads, keep the available Overview project summary in the work panel.

In the code: the Overview chart opens Work Gantt and its task inspector, where task details can be inspected.
A test that checks whether links are covered should sample the actual pointer target inside a Gantt row. A standalone chart can be stale even when there is no Overview summary, so suppress only the duplicate offline notice.

In the code: sample the Gantt label's hit rectangle in the launcher browser test.
