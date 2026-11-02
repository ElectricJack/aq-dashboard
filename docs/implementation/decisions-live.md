# Decisions inspection and revision-bound answers

The Decisions feature consumes configured human review APIs directly. `decisions.read` v1 gates inbox and exact-ID evidence. A separate `decisions.resolve` v1 gate controls answers. The first UI includes sampled Open/Resolved discovery, project scope, explicit bounded pagination, exact task/result/source references, actual retained acceptance text and reported conclusion when supplied by the owner, plus an evidence/context workspace. Artifact references remain references; no nonexistent artifact download links are presented.

The composition follows `03-decision-workspace-v3.png`: inbox, selected evidence and context columns; tablet stacks context and phone uses one column. Deferred scope includes arbitrary document content rendering, impact ranking, discussion and changes-since comparisons, since those facts have no paired owner in this increment. No sample impact/title is invented for production records.

Answer submission allocates one operation ID and freezes payload after first send. Unknown transport/5xx retains the exact answer for an explicit same-operation retry. A response must name the exact decision, actor, operation, choice, subject and recorded receipt revision before the UI claims recording. Conflict preserves the note and provides evidence refresh. Actual receipt confirmation does not claim task completion or publication. Current role/source/project/expiry checks remain server-owned.

Root integration: enable `decisions.read` version1 only with the installed review owner and current Owner role. Enable `decisions.resolve` independently after action qualification. The feature `index.tsx` replaces the existing routed stub; no route changes are needed. Shared workspace components come from UI-13. Feature tests install dedicated HTTP fixtures and do not alter the global handlers. Production builds must exclude mock fixtures as before.

The component/adapter test set covers disabled capability, empty discovery, source/evidence validation, exact identity, malformed states/cursors, retained criterion binding, uncertain delivery with identical retry bytes, positive actor/operation receipt, and conflict draft preservation. Actual owner/router and compiled-bundle browser qualification are separate from these fixtures.

The actual [configured SQL/review-owner browser read proof](../../../aq-server/docs/implementation/API-04-browser/README.md) passed in 2.75s, with desktop/390px screenshots reviewed. Separate [disposable browser action qualification](../../../aq-server/docs/implementation/API-04-browser/actions.md) passed in 2.88s. Approve/reject double clicks each produced one POST; a loopback fault proxy truncated a committed owner's HTTP reply, the UI retained an unknown answer, and an explicit identical-byte retry recovered its original receipt. Four POSTs resolved three disposable reviews, preserving source/subject pins. No browser response interception or provider calls occurred.

Both proofs used the unchanged bundle manifest SHA256 `85fa3dbfb790467dcaca3be6ce6ee7f448d9b2b39603f066df3b3811afbde2a8`. They establish the delivered discovery/evidence/answer subset, not full document/media/discussion design acceptance, task completion, merge/deployment or canonical-preview promotion. The review owner and both capability versions must be mounted in the promoted process before this behavior is available there.

## Current canonical availability

The [actual AQ37 UDS cutover](../../../aq-server/docs/implementation/evidence/canonical-uds-empty-owner-live/README.md)
now mounts the real review owner on canonical4188/source511ee99 with the same624
bundle. decisions.read and decisions.resolve are enabled; the current queue is
successfully empty. Canonical acceptance was read-only and submitted no answer.
The populated approve/reject/uncertain-retry proofs above remain separately labelled
disposable owner/action qualification. No review or downstream completion is invented
to fill the UI; full document/media/discussion design and pipeline automation remain open.
