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

- **The change** is a unified diff, either read from a file or computed by
  `git diff <base>...<head>` in the repository root.
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
- The spec and the diff are each **bounded** by `maxSpecChars` /
  `maxDiffChars` and truncated with an explicit marker when they exceed them.
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
- else **REVIEW** if any Noul is unclear, or the headline is *Minor drift*.
- else **CLEAN**.

## 6. Fail-closed guarantees

- If no `TYPESAFE_API_KEY` is available, the verdict is **NOT EVALUATED** and
  the run exits non-zero. The bot must never report a PR as clean without
  having reached Jev.
- If the API is unreachable, returns an error status, times out, or returns a
  malformed/incomplete answer, the verdict is **NOT EVALUATED** and the run
  exits non-zero. Transient `429`/`529` are retried with backoff before giving
  up.
- If the diff is empty, the verdict is **CLEAN** with a note (there is nothing
  to compare).
- If no spec files matched the configured globs, the verdict is **NOT
  EVALUATED** with a reason (there is no spec to compare against).

## 7. CI behavior

- By default the bot is **advisory**: it posts a comment and the check passes
  for CLEAN, REVIEW, and even DRIFT.
- When `blockOnDrift` is set, a DRIFT verdict (and any NOT_EVALUATED) makes
  the check fail.
- The report comment is posted even when the check fails.

## 8. Boundaries

- The bot inspects the diff text and the spec text; it does not execute the
  changed code and does not parse it into an AST.
- Jev is a probabilistic model; a probability near a threshold may flip between
  runs. Bands (not point estimates) are the unit of decision.
- The bot does not manage the API key's lifecycle; it only reads it from the
  environment and never logs it.
