# Dashboard visual requirements

The user requires pages to continue matching the approved design mockups while real infrastructure is connected.

Before changing a page, inspect its named reference in `docs/design/manifest.json` and `docs/design/*.png`, and read the corresponding section of `docs/specs/0002-product-design.md`. Follow `docs/design/visual-acceptance.md` for review and evidence.

- Preserve the reference's page hierarchy, pane proportions, typography, density, primary controls and responsive composition. Use existing shared tokens/components.
- Keep domain pages distinct: Work is a task workspace, Knowledge is a readable document library, Agents is a focused output workspace. Do not let a generic record inspector replace those designs.
- Render real or explicitly labelled fixture facts. Keep empty/unavailable states concise and within the intended layout; do not invent activity, quota, status or media to fill a mockup.
- API tests and successful navigation are separate from visual acceptance. Review actual desktop and phone screenshots before claiming visual completion. Check readable text, unclipped content, graph navigation and visible mobile exits/controls.
- Name each delivered visual subset and remaining differences. Full-page acceptance stays open while required panels or workflows are deferred.
- Coordinate shared shell, route, capability and component changes with the integration owner; feature changes should stay in their assigned files.
