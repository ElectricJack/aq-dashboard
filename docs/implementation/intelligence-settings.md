# Intelligence Settings editor

Settings → Intelligence profiles opens `/settings/intelligence`. The owner can view existing profiles and edit names, descriptions and configured provider/model/reasoning choices. Saving affects future launches and atomically updates the projects using the profile. Running sessions keep their original settings.

The form owns its opened snapshot. Conflicts preserve the draft, and interrupted responses are reconciled through the save operation ID; an explicit retry resends the identical original request. Backend validation remains authoritative. New providers/models must first be configured on the server; the UI does not invent model support or expose credentials. Creating entirely new profiles is outside this increment.

Implementation: `src/api/intelligenceSettings.ts`, `src/features/settings/intelligence.tsx`, shared Settings panels and tokens, the Settings management link, and the new route. The server implementation and transaction evidence are documented in aq-server `docs/implementation/intelligence-settings.md`.

Validation: nine Intelligence/FrameworkStatus component checks, production typecheck/build and mock-exclusion checks pass. Labelled fixture forms at 1440, 390 and 320 pixels have no horizontal overflow or axe violations. Desktop and phone captures were inspected. Settings has no separate approved PNG; this delivery preserves the shared shell/panel composition and qualifies the new profile-editor subset only. Full-dashboard acceptance and independent code review remain separate.

Captures and deployed bundle/rollback evidence: `/home/jkern/dev/aq-platform/qa/2026-11-09/intelligence-settings/`. The dashboard branch includes the preceding locally deployed Settings cleanup; its PR is based on that cleanup branch to preserve those changes.
