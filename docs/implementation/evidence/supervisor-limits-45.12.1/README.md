# Supervisor discovery limits below schema maxima (steady-cascade-45.12.1)

**Decision.** The discovery `limits` object holds server-advertised bounds. Each
value is treated as a maximum: the adapter accepts an integer from a floor up to
the pinned schema value. The schema values are 16384 / 16 / 4 / 16, from aq-server
`protocol/human-supervisor-conversation/v1`, digest `sha256:2056d6fe…`. The floors
are `body_bytes` 1, `context_refs` 0, `attachments` 0 and `history_page` 1. A
value of 0 disables context refs or attachments. Exact equality to the schema
values rejected the E0 server, whose older build (dashboard-refresh-c0a7399)
advertises `context_refs:0, attachments:0`. Both builds share the contract name
`human-supervisor-conversation-1`. The earlier vendored schema also had
`const 0` for both fields. The composer bounds message bodies by the advertised
`body_bytes`, and context refs and attachments are frozen within the advertised
limits.

**Reference.** `04-supervisor-chat.png`, `09-supervisor-full-desktop.png`, `12-supervisor-mobile.png`.

**Delivered visual subset.** The full Supervisor page renders inside the shell
(sidebar at 1440, bottom navigation at 390). It shows the global conversation
header and history, plus a text-only composer whose label reads
"Text only · no attachments or context" on desktop and "Text only" on phone.
There are no context chips and no attach/add-context controls. The whole-app
"Dashboard update required" gate does not appear, and neither viewport has
horizontal overflow.

**Deferred differences.** The mockup's context chips and paperclip attachments are
still unbuilt; that is gap-audit items B9/X5. The compatibility banner comes from
the fixture bootstrap, which lacks newer capabilities, and is unrelated to this
change.

**Captures.** `desktop-1440.png` and `phone-390.png` come from the compiled bundle
served by `AQ_DAEMON_URL=http://127.0.0.1:4197 pnpm preview --port 4198`.

**Served bundle.** `dist/dashboard-manifest.json` sha256 `4ea581bc…904779`
(source 3685c0d plus this change, dirty build).

**Provenance.** These are **labelled loopback test-double captures, not live
qualification.** `e0-stub.mjs` serves `contracts/live/fixtures/bootstrap.json`,
with the supervisor capabilities enabled, and an E0-shaped discovery
(`context_refs:0, attachments:0`) with one `[Fixture]` history item. The live E0
Compose stack `aq-e0-final` (port 32838) was not running during this task and was
not recreated here. The live 1440/390 capture remains for the G11 live review.

**Reviewer.** The implementing worker inspected both images.
