# Supervisor spec attachments (dashboard side)

Pinned contract: `contracts/live/supervisor-conversation` at aq-server `7206f5a1f1f2527f1a3afef476259cf621760a8c`
(`schema.json` sha256 `eda588e205779a11b74a319628f603a55e311358b3de345200d87fe6031f3ed3`, verified by a test against `source.json`).
Server prerequisites: upload/read contract (aq-server #226), extraction (#229), supervisor runtime contents (#230).

## Delivered (contract-backed, verified against an in-memory stand-in of the contract)

- Discovery `attachments` capability and effective limits drive the picker; absent capability or `limits.attachments` 0 keeps the composer text-only.
- Picker (`Attach file`) uploads each file immediately as raw bytes (`PUT .../attachments/{id}?name=`, exact media type, `X-AQ-Request`), shows name, type, size and status, and checks the returned digest/size/name/type against the picked bytes.
- Removal before sending: `DELETE` for staged files, abort plus best-effort `DELETE` for in-flight uploads, local removal for rejected files; a failed `DELETE` keeps the file listed.
- Client-side refusals (unsupported type, empty, oversized, invalid name, over the per-message count) are listed by name and never uploaded; server refusals (`AttachmentError` codes) show their reason. Retryable failures offer Retry with the same attachment id. Sending is blocked while any file is uploading or failed, so nothing is dropped silently.
- Send binds ordered `{id, digest}` refs in the existing `supervisor.message.send` action payload; history descriptors render under the human message after reload.
- The same composer serves the global and project supervisors (`projectId` selects the conversation id the uploads are addressed to).

## Not evidenced here

- No live aq-server stack was reachable from the build sandbox, so upload, extraction, access control (other users' conversations) and delivery of document contents to the supervisor are server-owned behaviours that were **not** exercised end to end from this change. Run the compatible test stack with a PDF, Markdown, text and DOCX fixture and "Review the attached spec" before treating the feature as accepted.
- Desktop/phone screenshots for the composer change (docs/design/visual-acceptance.md) were not captured; the new controls reuse existing tokens only.
- Staged-but-unsent files are held in page state; after a full reload they are not re-listed and expire server-side after `staged_ttl_ms`.
