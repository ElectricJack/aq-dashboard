---
title: Open the compiled workflow first on Playbooks
author: Jack
date: 2026-11-18
branch: feat/playbooks-graph-first
cost: { minutes: 28, tokens: 283419 }
id: l-9218fa77
scope: repo
status: active
src: agent
touches:
  - src/features/playbooks/Playbooks.tsx
  - docs/specs/0002-product-design.md
---

## Decided

The Playbooks landing page should answer what a workflow does. The user prefers the v1 node graph as the starting point. Keep run history one tab away, put version and rollback controls under Deployments, and show request-to-run outcomes under Run history as Start requests.

## Tried and ruled out

The existing Run history timeline describes a particular execution. It cannot show unvisited branches or a playbook that has never run. The current catalog lists artifacts and entry names but does not carry transitions.

## Watch out

Match the immutable artifact digest and namespace. A run's Definition tab must keep showing the workflow for its pinned version even after deployment moves to another version. A missing stored graph should leave the playbook and its metadata available.

In the code: the dashboard reads the owner-scoped install-time projection from `/api/playbooks/inspection/definitions/{artifact}/graph`. The projection is shared with the server's run inspection.
