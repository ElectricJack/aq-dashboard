---
title: Offer an all-projects exit when a selected project has no playbook library
author: Jack
date: 2026-11-18
branch: fix/playbooks-project-scope
cost: { minutes: 30, tokens: 70437 }
id: l-555318cc
scope: repo
status: active
src: agent
touches:
  - src/features/playbooks/CurrentCatalog.tsx
  - src/features/playbooks/Playbooks.tsx
---

## Decided

When a project-scoped Playbooks collection is unavailable, explain the selected scope and offer a link that removes the project filter while keeping the current Playbooks view. Keep the exact-item error for failed individual lookups.

## Tried and ruled out

The rollout browser probe opened a fresh All projects URL. That passed while project-scoped navigation still showed a generic missing-item message. Silently discarding the project selection would hide the scope change from the user.

## Watch out

The live runtime can serve a single playbook namespace even when the project picker lists several repositories. A project outside that namespace gets a scoped 404 from the collection. Probe both a matching project and a different project when qualifying Playbooks on a real runtime.

In the code: the catalog client classifies failures at response headers and leaves their bodies unread. The scope recovery uses the project filter and HTTP status while preserving routing and authorization.
