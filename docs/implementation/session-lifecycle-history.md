# Session lifecycle history

Roster and session peek can display optional recorded worker Start/Stop times and
central execution state. These are separate from live process observation, which
may remain unknown, and from terminal availability. Provider/model/harness labels
identify the configured profile.

Missing `lifecycle` on an older server displays “Lifecycle history unavailable”.
An implemented read with both nullable times empty displays “No worker lifecycle
reports”. A recorded start never becomes a current running claim; stop history
never becomes task completion. No control or terminal capability is enabled.

The daemon reads one indexed immutable receipt pair inside the existing exact
session inspection ACL transaction. Native worker facts queued only on disk
cannot appear until the owning daemon Started/Stopped handlers admit them.

Validation: 34 focused adapter/live-contract/Agents tests pass; typecheck and
production bundle build pass (20 manifest files, mock code excluded). The paired
daemon projection passes six actual SQL/human-router cases including receipt
history, unknown process state, exact Viewer ACL and expiry. No live terminal or
real provider execution is claimed by these presentation tests.
