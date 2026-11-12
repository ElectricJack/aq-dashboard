# Provider reset details

Implemented in `feat/provider-reset-details` using a GPT-6.1 Terra dashboard
sub-agent, alongside Terra producer/server agents. Root independently reviewed
the changes, corrected findings, and verified the result. The matching server
implementation and plan are retained in the server repository at
`docs/implementation/provider-reset-details.md` and
`docs/superpowers/plans/2026-11-11-provider-reset-details.md`.

## Behavior and contract

The account-wide usage disclosure now shows available resets per provider
account. Known counts (including zero), unknown/unavailable readings, independently
stale reset observations, expiry dates and grant restrictions remain distinct.
Provider keys are converted to readable limit labels. A grant that expires after
observation shows Expired even if its earlier usable flag was true. A failed
refresh marks retained reset information stale without changing its observation
time. The compact usage header retains its existing composition.

The canonical dashboard-read contract is pinned from actual server commit
`4aa15a249e4d0380b29cde81c0baea758e90fc67`, with regenerated schema and verified
hashes. Old responses that omit reset metadata remain supported. This is a local
implementation pin, not a claim that the server commit has been published.

Codex's existing app-server read supplies the available count. Claude's current
structured SDK usage control supplies plan windows but no qualified independent
grant read; Claude resets therefore show Unknown. Real Claude usage collection
continues. No redemption controls or automated reset use were added.

## Root validation

- `pnpm test -- src/api/adapters/providerUsage.test.ts src/components/ProviderUsageStrip/ProviderUsageStrip.test.tsx src/app/useProviderUsage.test.ts src/app/Shell.test.tsx`: 81 passed.
- `pnpm run typecheck`, `pnpm run lint`, and `pnpm run build`: passed. The production
  bundle check confirms no mock code or fixtures are included.
- Canonical pinned contract fixture validation and pin digest verification passed.
- After repinning, the canonical overview-contract and mock-scenario consumer
  tests also passed (16 tests, for 97 dashboard tests across the root runs).
- Root independently ran server/producer checks: 9 producer tests, 8 quota tests,
  4 contract tests, schema drift/fixture checks, Rust formatting, Clippy with
  warnings denied, and build budgets.
- Root read both installed live clients through the updated producer into a
  private temporary file: both quota sources refreshed; Codex reset count was
  known zero and Claude reset availability was unknown. See the sanitized
  `root-live-client-summary.json` evidence; running service data was untouched.

Root also exercised a deterministic Python producer -> Rust snapshot collector ->
canonical schema -> compiled React view boundary. Codex count 3 survived one
detail row, Claude stayed unknown, and both usage windows showed 35% used. The
account payload was unchanged; only the transport envelope version label was
matched to the compiled preview's proposed-0 mock bootstrap.

## Visual review

- Reference: `docs/design/01-overview-v3.png`, product spec section 3 and the visual
  acceptance requirements.
- Delivered subset: provider reset details in the existing usage disclosure.
- Root personally captured and opened known/zero and unknown/stale examples at
  1440, 390 and 320 pixels, plus the cross-language case at 390 pixels.
- The compiled preview is explicitly labelled Mock data; these are deterministic
  fixture captures, not screenshots of the deployed live API.
- No document horizontal overflow, page errors, clipped close button, or
  Escape/focus regression was found. Full-page design acceptance and changes to
  unrelated panels remain outside this increment.
- Evidence: `docs/implementation/evidence/provider-reset-details/`, with seven
  screenshots, `root-browser-review.json`, and the actual served fixture manifest.
  Its SHA-256 is
  `6f60111dbee44a2f33cbd0fd415f101295d5cca907e39ea753a5d2d130dd98a1`.

For repeatable compiled fixture review, build with
`VITE_FIXTURE_BUILD=true pnpm exec vite build --mode mock --outDir dist-reset-fixture`
and run `pnpm exec vite preview --outDir dist-reset-fixture`. The scenarios
`?scenario=reset-credits` and `?scenario=reset-credits-other` cover known/zero and
unknown/stale states respectively. Normal production builds exclude those mocks.

## Operational state

The reviewed implementation is local to the server/dashboard feature branches.
The running server image, host refresh service and served dashboard bundle have
not been deployed or changed. Claude reset-count support remains limited by the
selected native client interface.
