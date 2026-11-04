# DC-N: labelled Decisions mock fixtures (calm-vault-46.3)

Captured from `vite --mode mock` by `tests/decision-fixtures.spec.ts` with `DCN_EVIDENCE_DIR` set, at 1440x900 (`-desktop-1440`) and 390x844 (`-phone-390`), full page.

| File | State |
|---|---|
| decisions-open-* | `/decisions?state=open`: current, superseded ("Result has a newer report") and other-project reviews |
| decisions-resolved-* | `/decisions?state=closed`, first resolved review selected: "Recorded decision: …" from its receipt |
| decisions-form-* | Current review with the fixture principal eligible and `decisions.resolve` offered |
| decisions-recorded-* | After "Approve revision 1": "Recorded decision: approve"; the review leaves Open |
| decisions-failed-* | `?scenario=reads-failed`: the inbox error, not an empty inbox |

Before: docs/evidence/gap-audit-2026-11-03/decisions-d.jpg, decisions-m.jpg, decisions-closed-d.jpg, decisions-failed-d.jpg, decisions-submit-d.jpg.

Every fact is a labelled fixture (src/mocks/decisionFixtures.ts): criteria start "Fixture:", recorded results "Fixture ·", evidence refs `fixture-…`.

Remaining differences (owned by other tasks): inbox rows still show raw short ids, so the three open rows read alike (D9, DC-L); the action bar is inline, not the reference's bottom bar (D3/D4, DC-K); evidence header and superseded callout (D12/D15, DC-M); the full-page captures show the shell's empty column below the content.
