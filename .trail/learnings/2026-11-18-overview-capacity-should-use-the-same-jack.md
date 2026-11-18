---
title: Overview capacity should use the same current machines as Swarm
author: Jack
date: 2026-11-18
branch: feat/overview-capacity
cost: { minutes: 7, tokens: 49452 }
id: l-2915ce45
scope: repo
status: active
src: agent
touches:
  - src/features/overview/Infrastructure.tsx
  - src/features/overview/capacity.ts
  - src/api/adapters/swarm.ts
---

## Decided

Use the Swarm read for fleet capacity in Overview. The enrollment list includes historical and revoked workers and lacks a reliable shared slot count. Headline availability is installation-wide and uses the server-reported idle count, worker holds, and machine maximum. Show the lowest fresh reading by resource so a fleet average cannot hide one crowded machine.

## Tried and ruled out

Startup credential configuration and the full enrollment list took up the Capacity pane without answering how many more agents could start. Subtracting occupied slots from configured slots can invent open slots when Swarm reports a worker-wide hold.

## Watch out

Idle capacity still depends on project, provider, and worker admission. Keep missing totals and stale or missing telemetry explicit. The current worker machine report has CPU, memory, and disk fields but no GPU reading.

In the code:
`src/features/overview/Infrastructure.tsx` uses GET /api/v1/swarm with the same cache key as Swarm. Capacity view calculations live in `src/features/overview/capacity.ts`.
