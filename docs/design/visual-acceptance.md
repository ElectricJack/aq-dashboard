# Visual acceptance against the approved mockups

User requirement reaffirmed November 1, 2026: pages must continue to look like the accepted design mocks while real infrastructure is connected. The [selected gallery](index.html), [asset manifest](manifest.json), and [product design](../specs/0002-product-design.md) are the references. Product text governs behavior where mockup generations differ.

API completion and visual completion are separate. A successful endpoint, component test or browser navigation does not establish that the page matches its reference. Each feature owner reviews the reference image and the rendered page before declaring its visual increment ready.

## Reference and composition checklist

| Page | Reference | Preserve in the implementation |
| --- | --- | --- |
| Overview | `01-overview-v3.png` | Compact status band; attention/work/outcomes main column; capacity/health/pinned-session secondary column; clear hierarchy and dense useful rows |
| Work | `02-work-explorer-v3.png` | List/graph switch and filters; prominent dependency workspace; contextual inspector; graph navigation and selection remain usable |
| Decisions | `03-decision-workspace-v3.png` | Inbox navigation, substantial evidence/proposal workspace, supporting context and clearly placed decision controls |
| Supervisor | `04-supervisor-chat.png`, `09-supervisor-full-desktop.png`, `12-supervisor-mobile.png` | Docked/full presentation of one conversation; readable message width; context chips and composer; keyboard-aware phone layout |
| Playbooks | `06-playbooks.png` | Runs/Definitions/Activations navigation, useful run list and selected step timeline, visible waits/child runs/receipts |
| Knowledge | `07-knowledge-v2.png` | Searchable/filterable library, readable document content and sources, contextual metadata/verification; document hierarchy rather than a generic record dump |
| Agents | `08-agents-focus-desktop.png`, `11-agent-mobile-v2.png` | One large readable output workspace, compact session tabs/switcher, status footer, on-demand details; phone focus and an accessible exit |
| Results | `10-results-desktop-v2.png`, `13-results-mobile-v2.png` | Centered evidence feed and distinct cards; exact result context; substantial media when supported; selected discussion panel and phone composition |
| Agents › Swarm | `14-swarm-tree-v3.png` (tree); `swarm-tree-v4.html` (2026-11-11 revised controls prototype) | Preserve the tree and properties composition, with the owner’s latest changes: two provider sliders in one row with automatic saving and measured burn estimates; Max agents in each Intelligence row, using its existing Save. Agent/free-slot cards stack two columns wide beneath each worker. The desktop tree/properties divider is draggable and keyboard-adjustable; phones keep the stacked layout. Older v4 controls are superseded. |
| Settings | Shared product design; no separate selected PNG | Consistent shell, panels, controls, spacing and disclosures; technical identities grouped under details |

## Required review for each visual delivery

- Name the reference images and the delivered subset. Record deferred sections explicitly; a metadata-only Results increment cannot close the complete media/feed design.
- Compare hierarchy, pane proportions, alignment, typography, spacing, density, selected states and primary control placement. Reuse the shared design tokens and controls.
- Keep unavailable/empty facts inside their intended composition with concise user-facing explanations. Data limitations do not justify replacing the page with a long technical status report. Never invent counts, activity or media to fill the reference.
- Use real API data for live qualification and labelled deterministic fixtures for repeatable visual coverage. Review a nonempty case as well as empty/unavailable behavior.
- Capture desktop and phone viewports independently, normally 1440px and 390px; check 320px reflow and tablet transitions where relevant. Verify titles/body text are readable, focus is unobscured, graphs have usable internal navigation, and the page does not overflow horizontally.
- Inspect the actual images. Wait for layout/paint and check fresh viewports if a resize produces a capture artifact; do not hide clipping with blanket overflow rules. Keep a viewport-only phone capture when full-page capture misplaces fixed navigation.
- Record remaining differences and fix material composition/readability regressions before promoting that visual increment. Keep full-page design acceptance open while required panels or interactions are deferred.
- Root verifies the compiled bundle actually served by the preview. Source screenshots or mock-only checks alone do not establish the live page's appearance.

The feature record should state **reference / delivered visual subset / deferred differences / desktop and phone captures / reviewer / served bundle**. No per-pixel equality is expected for variable content, but required page structure and interaction patterns remain part of acceptance.
