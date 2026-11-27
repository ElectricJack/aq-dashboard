# Needs-you attention list and dismissal (PROPOSED)

**Status: PROPOSED. No such route exists in aq-server today; nothing in the dashboard calls it.** Written for aq-server task 602c3994 and dashboard task b5a944dc.

## Observed (current main, source only)

- `GET /api/v1/overview` returns `attention[]` of kinds `decision`, `question`, `blocked`, `failed`, `uncertain_operation`, `worker_offline`, `internal_work`, and `counts.needs_you` over all of them.
- The Decisions inbox reads only `/api/reviews/decisions`, the question inbox and host decisions. It never listed the other five kinds, so an overview of 10 non-decision items opened an empty Decisions page. The dashboard now lists those items on Decisions ("Other items that need you") from the same overview read.
- The overview carries no continuation cursor; the list is the server's sample. The dashboard states when `needs_you` exceeds the items listed.
- No dismissal route, persistence or capability exists, so the dashboard offers no Dismiss control.

## Needed from aq-server for persistent dismissal

1. Capability `attention.dismiss` in `GET /api/v1/bootstrap` (absent or disabled hides the control).
2. `POST /api/v1/attention/{attention_id}/dismiss`, body `{ "expected_revision": <subject revision from the item> }`, owner or project scope checked on every call.
3. Idempotent: repeating returns 200 with the same dismissed record; an already-gone item is not an error. A changed revision returns 409.
4. Refuses (409/422) for kinds `decision` and `question`, and for any item that is an unresolved review gate. Dismissal never approves, releases, cancels or resolves anything.
5. Dismissed items are excluded from both `attention[]` and `counts.needs_you` in `GET /api/v1/overview` for that principal, so count and list stay in agreement across refresh.
6. Optional: `attention[]` continuation (`cursor`, `limit`) or a full list route so counts above the sample size can be listed.

The dashboard will add the control only against this published contract, with its own tests.

## Dashboard behaviour (task fd752dc4)

The dashboard now calls this route, gated on capability `attention.dismiss`. The control shows only on kinds `blocked`, `failed`, `worker_offline` and `internal_work` that carry a subject revision and no decision-style action (never `decision`, `question`, `uncertain_operation` or a review gate). It sends `{ expected_revision: subject.revision }`, removes the item and lowers `needs_you` at once, then re-reads the overview. 404/410 count as already dismissed; 409/422 are not shown as errors (the re-read decides); any other failure restores the row with "Couldn't dismiss. Try again."
