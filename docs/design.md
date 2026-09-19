# Design & behavior contract

This document is the spec that pi-spec-drift holds *itself* to. A change to
this repository is **drift** if it violates a statement below. Keep these
statements precise: they are the thing the bot reads on its own pull requests.

## 1. Purpose

pi-spec-drift is a decision tool, not a code generator. Given a code change
and a written specification, it decides — and reports — whether the two have
diverged. It never edits the spec, never edits the code, and never writes
prose verdicts; the verdict is derived from Jev's probabilities by fixed rules
in code.

## 2. Inputs

- **The change** is a git-format unified diff, either read from a file or computed by
  `git diff <base>...<head>` in the repository root. A source must be supplied;
  omitting both forms is a usage error (exit 2). External diff/textconv helpers
  are disabled. Output report paths resolve against the process working directory,
  independently of `--root`; CI passes absolute paths.
- **The spec** is the set of files matched by the configured `specFiles`
  globs, minus any file matched by `excludeGlobs`.
- **Context** is the pull-request title and description when provided.

## 3. Payload contract

The only content sent to the TypeSafe API is the structured `state` object:
the task tag, a fixed definition sentence, the repository/branch/PR context,
the matched spec file contents, and the change's diff.

- Every string sent to the API **must pass through redaction first**. Obvious
  credentials — GitHub tokens, AWS keys, `sk-` API keys, Slack tokens, PEM
  private keys, `Bearer` tokens, JWTs, and `KEY/TOKEN/SECRET/PASSWORD`
  assignments — are replaced with a `[REDACTED:…]` marker before transmission.
  This is best-effort pattern matching, not proof that arbitrary secrets are absent.
- The spec and the diff are each **bounded** by `maxSpecChars` /
  `maxDiffChars` and truncated with an explicit marker when they exceed them.
- PR titles/descriptions are bounded to 256/4000 characters. Repository/ref/path
  metadata strings are bounded to 512 characters; file lists include at most 100
  entries. Spec/diff budgets include truncation markers. Symlinks are skipped.
- File contents of non-spec files, assistant output, and prior terminal output
  are **never** sent.

## 4. Questions

The bot asks exactly five Noul (yes/no) questions and one Score question, all
in a single `POST /v1/systemone` call. The Nouls are phrased so a high
probability means *no problem* for that dimension:

`conforms_to_spec`, `spec_still_accurate`, `behavior_is_spec_covered`,
`within_stated_scope`, `intent_matches_diff`; plus the `drift_level` Score with
levels No drift → Minor drift → Significant drift → Contradiction.

## 5. Verdict rules

Each Noul with threshold `t` is classified: **satisfied** if `p ≥ t`,
**violated** if `p ≤ 1 − t`, else **unclear** (probabilities are rounded to
1e-6 before comparison so IEEE-754 boundary values land in the right band).

- **DRIFT** if any Noul is violated, or the `drift_level` headline is
  *Significant drift* or *Contradiction* with top-level probability ≥ its
  threshold.
- else **REVIEW** if any Noul is unclear, the headline is *Minor drift*, or
  a modal *Significant drift*/*Contradiction* level is below its threshold.
  Score levels use the documented zero-based criterion indexes, never returned
  legend wording ([TypeSafe Score contract](https://docs.typesafe.ai/primitives/score)).
- else **CLEAN**.

## 6. Fail-closed guarantees

- If no `TYPESAFE_API_KEY` is available, the verdict is **NOT EVALUATED** and
  the run exits non-zero. The bot must never report a PR as clean without
  having reached Jev.
- If the API is unreachable, returns an error status, times out, or returns a
  malformed/incomplete answer, the verdict is **NOT EVALUATED** and the run
  exits non-zero. Transient `429`/`529` are retried with backoff before giving
  up.
- An explicitly supplied, genuinely empty diff yields **CLEAN** with a note
  (the deliberate no-API exception). Nonempty input that filters to nothing,
  or contains no supported diff sections, is **NOT EVALUATED**, never CLEAN.
- If no spec files matched the configured globs, the verdict is **NOT
  EVALUATED** with a reason (there is no spec to compare against). Matched but
  entirely whitespace-only specs also fail closed. Malformed answers include
  missing/wrong types, non-finite or out-of-range numbers, and incomplete or
  non-normalized Score distributions (sum tolerance 1e-6).

## 7. CI behavior

- By default the bot is **advisory**: it posts a comment and the check passes
  for CLEAN, REVIEW, and even DRIFT.
- When `blockOnDrift` is set, a DRIFT verdict (and any NOT_EVALUATED) makes
  the check fail.
- A freshly generated report is posted even when the evaluation step fails,
  provided GitHub grants comment permission. Checkout/build failures may yield
  no report. Reports are never read from the PR checkout.
- The reusable workflow requires explicit trusted `bot-ref`; production callers
  pin it and the workflow to the same reviewed commit. Fork/Dependabot runs may
  lack secrets/write permissions and are not automatically privileged.

## 8. Boundaries

- The bot inspects the diff text and the spec text; it does not execute the
  changed code and does not parse it into an AST.
- Jev is a probabilistic model; a probability near a threshold may flip between
  runs. Bands (not point estimates) are the unit of decision.
- Specs and configuration from the PR remain untrusted advisory inputs. Rejecting
  all-excluded diffs does not prevent selective exclusions, changed specs, or
  altered thresholds from influencing a verdict. This is not a tamper-proof gate.
- The bot does not manage the API key's lifecycle; it only reads it from the
  environment and never logs it.
