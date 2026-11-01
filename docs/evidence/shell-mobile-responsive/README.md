# Compact shared phone header: compiled candidate acceptance

References: [`11-agent-mobile-v2.png`](../../design/11-agent-mobile-v2.png),
[`12-supervisor-mobile.png`](../../design/12-supervisor-mobile.png), product
shell/accessibility requirements and [visual acceptance](../../design/visual-acceptance.md).
Reviewer: `/root/visual_agents_v2`, November 1, 2026.

Delivered visual subset: a compact shared phone header retains brand/project on
its first row, then Search, concise usage disclosure and separate connection
status. It uses shared tokens and native project selection. Unavailable usage is
not converted into a quota or provider brand. Its exact server-provided reason
opens in a locally bounded overlay; closing or pressing Escape restores focus to
the summary. Opening it does not change header height or push the Supervisor
composer downward. Search keeps its existing dialog/shortcut and focus return.
Actual ready-quota content remains the existing account/window/freshness strip
and may wrap into an additional row; its facts are not replaced by unavailable
copy. Focused Agents retains one header row, its own All sessions exit, and no
phone bottom navigation.

The immutable compiled candidate at `http://localhost:4204` was served by the
actual cloned AQ/Graph state35 listener. Bootstrap digest exactly matched the
compiled manifest:
`2b3d3d6ee8be801288f2f7c95446ac18e73e80e8010c18d905885e9d4b077689`.
The browser pass took 6292ms. Desktop header measured 69px; phone header measured
114px at both 390 and 320px; focused Agents measured 62px at both phone widths.
All checks used GET/HEAD only, with zero foreign requests or page errors. Header
controls met the 44px target, the reason panel stayed within local phone bounds,
Close/Escape/search/project focus behavior passed, and no document horizontal
overflow occurred. Project selection preserved its URL value. No data-fetch,
authorization or route ownership changed in this source increment.

Actual desktop and phone screenshots were inspected. The first row keeps brand
and project aligned; the second keeps unavailable usage and Connected distinct.
The reason overlay is readable at 320px. The focused output pane retains truthful
Not watching/no output/incomplete labels; no Watch action was invoked. The
read-only Supervisor view retains a global header, history and composer. At
390/320px, its 44px Send control occupied y711–755, above the bottom navigation at
y787. No input was typed and no message was enqueued. Supervisor history was
empty in this actual clone; the separate feature-owner fixture qualifies its
nonempty enqueue workflow. This record does not claim a live supervisor reply,
attachments, human delivery, populated quota producer or full-page feature
acceptance.

The earlier source/dev proxy pass is retained separately and is not production
acceptance. Against the actual4188 API, it measured a 114px phone header versus
the old canonical header's 192px at390 and236px at320; desktop stayed69px.
Source/dev checks also verified overlay geometry and focused header behavior.
The compiled candidate pass above supersedes source-only layout evidence for
this exact bundle. Canonical preview promotion remains the integration owner's
separate step.

- [Actual compiled-bundle result](result.json), [exact read-only probe](probe.mjs) and [process log](process.log).
- [Artifact pins and limits](artifacts.json), including exact manifest/probe/screenshot hashes and absolute source paths.
- [Earlier source/dev geometry](source-dev-result.json) and [focused-source check](source-dev-focused-result.json).
- Actual shell captures: `/tmp/aq-shell-responsive-production/shell-{1440,390,320}.png`.
- Actual disclosure captures: `/tmp/aq-shell-responsive-production/usage-reason-{390,320}.png`.
- Actual selected-scope captures: `/tmp/aq-shell-responsive-production/scope-{390,320}.png`.
- Actual focused output captures: `/tmp/aq-shell-responsive-production/agents-{390,320}.png`.
- Actual read-only chat captures: `/tmp/aq-shell-responsive-production/supervisor-{1440,390,320}.png`.

Source validation: 40 existing Shell/provider tests passed in2.72s; 23 existing
Search/Agents tests passed in4.33s; exact `tsc -b` passed. Root separately reported
464 composite tests in21.33s and the29-asset production build in564ms. This lane
performed no production build or Cargo invocation.
