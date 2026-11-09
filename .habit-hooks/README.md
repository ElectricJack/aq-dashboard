# Habit Hooks pilot

Started 2026-11-09 and planned to run about two weeks. [Habit Hooks](https://github.com/habit-hooks/habit-hooks)
runs linters and turns each finding into a short coaching guide for the agent,
so it fixes the smell rather than gaming the metric. The question this pilot
answers: does that coaching make agent-written code better, and at what cost
in time?

## Running it

```sh
habit-hooks                        # this branch's changes vs main (the normal run)
HABIT_HOOKS_ALL_LINES=1 habit-hooks --all   # full audit: every finding in the repo
```

Exit codes: `0` nothing enforced, `1` an enforced smell to fix, `2` the tool
itself failed. The CLI is installed user-wide (`uv tool install "habit-hooks[all]"`).
The detectors it runs are dev dependencies here.

## Setup decisions

| Choice | Why |
| --- | --- |
| Plugins `typescript`, `generic` only | The python plugin hands ruff every file in scope, including `.ts`, which produced 153,641 bogus parse errors. The repo's Python is a dozen contract and evidence scripts. |
| `typescript` aliased to `@typescript/typescript6`, `@typescript/native` = TypeScript 7 | typescript-eslint 8.72 refuses TypeScript 7. This is the side-by-side setup the TypeScript 7 release notes recommend: `tsc` is still 7.0.2 (typecheck and build unchanged), and tools that load the `typescript` API get 6.0. pnpm overrides and packageExtensions cannot redirect a peer dependency, so a narrower fix was not possible. Remove the alias once typescript-eslint supports TS 7. |
| Bundled ESLint rules (no project `eslint.config.mjs`) | The pilot tests Habit Hooks' own thresholds: functions up to 12 lines, 3 parameters, complexity 10, files up to 200 lines. |
| `knip.json` with the playwright plugin off | knip reads `package.json` scripts and loads `playwright.live.config.ts`, which throws without `AQ_LIVE_URL`. Spec files and configs are listed as entries instead. |
| `.jscpd.json` | Without it, jscpd's fallback config scans only `src/`. |
| `transformers = ["changed-lines"]`, no snooze index | Snoozes are per file and re-arm on any edit: an average commit here would have brought back about 44 old findings. `changed-lines.cjs` keeps a finding only if this branch wrote, changed or grew the code. |

### How `changed-lines` decides

Compared against `git merge-base HEAD main`, including uncommitted and untracked work:

- Function size and complexity are reported when the branch wrote the function or made it longer. Function spans come from the TypeScript parser. This is a ratchet: editing an old long function without growing it stays quiet.
- Too many parameters is reported when the signature line changed, or the function grew.
- Oversized file is reported when the branch made the file longer.
- Duplicated code is reported when either copy has a changed line.
- An unused file or dependency is reported when the file was touched.
- Everything else (unused exports, lint, comments) is reported when its line changed.

Known gap: knip's dead-code findings are whole-project, so an export made dead
by deleting its last caller in another file is not reported.

## Measured cost (20 most recent commits on main, replayed 2026-11-09)

| | Findings per commit (median / p90) | Enforced per commit (median / p90) |
| --- | --- | --- |
| No filter (stock Habit Hooks) | 44.5 / 205 | 14.5 / 76 |
| `changed-lines` | 10.5 / 27 | 5.5 / 16 |

What `changed-lines` still reports: about 4 functions per commit that were
written or grown past 12 lines, plus suggestions (non-null assertions,
comments). A full run takes about 6 s, and `pnpm test` / `typecheck` / `build`
are unaffected.

## Evaluating the pilot

Compare pilot-period tasks against the two weeks before:

- **Cost:** AQ task wall time and turns, and the extra commits or diff size that habit-hooks fixes add.
- **Quality:** review findings per PR. Spot-check whether reported smells were fixed for real or gamed (`partA`/`partB` splits, merged conditions, suppressions).
- **Noise:** findings the agent judged wrong, and whether any smell should be demoted (`[smells.<name>] severity = "suggested"`) or a threshold changed with a project `eslint.config.mjs`.

To turn it off, delete the instructions in `AGENTS.md` and `.aq/PRIME.md`. The
config can stay.
