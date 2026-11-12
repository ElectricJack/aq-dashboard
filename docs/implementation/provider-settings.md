# Providers in Settings

The Providers tab lists configured provider names, accounts and credential-presence status. Add provider and Remove stage membership edits; Undo removal restores the row before saving. Available choices come from server configuration. Creating new connections and entering credentials are outside this increment; the page says so explicitly and never implies credential presence proves authentication or readiness.

One Save in the Settings header saves pending Intelligence edits and provider membership, including drafts in hidden visited tabs. Native close/reload and in-app leave warnings protect both sections. Conflicts retain the provider draft until explicit discard/reload. Uncertain saves keep their operation identity for receipt lookup and exact retry. The Intelligence selector retains old provider mappings for editing, labels removed entries, and links to Providers; Swarm controls hide unused removed providers and keep running ones visible without editable sliders. Existing account-wide usage facts remain unchanged.

The API is owner-only GET/POST `/api/settings/providers` plus GET `/api/settings/providers/operations/{id}`. The server derives available choices from safe startup account metadata. Membership saves use expected document and available-provider revisions. Migration 118 is additive. The server masks provider eligibility before selection and rechecks admission, independently of the Intelligence parent/profile routing policy. Already reserved agents retain their original admission.

## Verification

- 62 focused component/contract checks (57 Settings/Swarm header checks plus 5 provider adapter checks).
- 28 browser checks across Providers, Intelligence, existing Settings tab navigation and Swarm controls. Covers a single Save across both edited tabs, add/remove/reload, native beforeunload, Stay/Leave and responsive accessibility.
- Typecheck, build-script lint and whitespace checks.
- Reference: shared Settings composition in product design and visual-acceptance.md; no separate approved Settings PNG. Delivered subset: provider membership and shared Save/warnings; connection/credential creation deferred.
- Desktop 1440px and phone 390/320px captures in `/home/jkern/dev/aq-platform/qa/2026-11-12/providers-settings/`. Root inspected the actual desktop and phone images; no page overflow and no WCAG A/AA violations in fixture captures or leave dialog.

The live verification record is appended after deployment; fixture screenshots alone do not establish the served bundle.
