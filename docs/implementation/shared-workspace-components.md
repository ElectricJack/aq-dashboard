# Shared workspace presentation handoff (UI-13)

`src/components/layout/Workspace.tsx` exports stable presentation helpers:

- `Panel`: section props plus required `title` and optional `description`/`actions` React nodes. It generates a heading association. Children hold feature content.
- `Toolbar`: wrapping div with responsive flex layout; no toolbar keyboard or domain semantics are implied.
- `ActionButton`: native button props, default type button and a 44px minimum height. Callers own authorization, pending state, handlers and labels.
- `DetailList`: native dl props; caller supplies semantic dt/dd pairs. Long identifiers wrap and phone fields stack.

These helpers use existing tokens and require no provider/query/router dependency. Existing components remain supported; features can adopt these without waiting for shared visual refinement. Feature modules retain their data/capability policy and own their adapters/fixtures. Global route/query/mock composition remains with the integration owner.

The focused Agents increment consumes this interface. UI-05 visual refinement and each feature's live/design acceptance remain separate from this handoff.
