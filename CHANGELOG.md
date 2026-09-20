# Changelog

## Unreleased

Correctness fixes from the pre-merge code review.

- Redaction: the `secret-assignment` rule was case-insensitive and let its
  separator cross newlines, so it rewrote ordinary code (`tokens = tokenize(x)`,
  `publicKey = derivePublicKey(s)`) and swallowed the line after a bare
  `API_KEY:` heading. Since the diff and spec are the only evidence the verdict
  is computed from, this corrupted the model's input. The rule is now
  case-sensitive (UPPER_SNAKE may carry the word anywhere; mixed-case names must
  end on it), matches horizontal whitespace only, and rejects a value that is
  really a call.
- Action: `block` no longer defaults to `"false"`. It was always forwarded as a
  CLI flag, which outranks `.spec-drift.json` and `SPEC_DRIFT_BLOCK`, so a repo
  that set `blockOnDrift: true` was silently downgraded to advisory. An unset
  input is now a no-op.
- Config: `maxSpecChars` / `maxDiffChars` are validated as non-negative whole
  numbers, and thresholds as real numbers in `(0.5, 1]` with known keys. A
  fractional budget used to throw `Invalid text budget` part-way through state
  building, and a JSON *string* threshold passed `isFinite` coercion and then
  crashed `toFixed` in the renderer; both now report a clear configuration
  error, and an out-of-range threshold is reported rather than silently dropped.
- CLI: `--block false` set blocking *on* (the space form consumed no value and
  the bare `false` was dropped as a positional). Boolean flags now accept an
  explicit `true`/`false` in the space form.
- Diff parsing: file paths are read from the `+++`/`---` lines rather than the
  ambiguous `diff --git` header, so paths containing spaces no longer yield
  garbage entries in `changedFiles` or defeat non-anchored exclude globs. Only
  the section preamble is searched, so an added line that reads `+++ ...` is not
  mistaken for a header.
- Verdict: a Noul with no threshold in the map is no longer skipped — it fell
  out of the verdict entirely, so a library caller passing a partial threshold
  map could get `CLEAN` while a dimension was violated. It now falls back to the
  documented default and otherwise fails closed.
- Report: `safeText` also escapes `[]()`, so an untrusted PR title or repository
  name cannot plant a markdown link in the bot's own comment.
- Report JSON: the headline row published Jev's `score` under the generic
  `value` field. Per the [Score contract](https://docs.typesafe.ai/primitives/score)
  that field is the probability-weighted mean over level *indexes* (0–3 here),
  while the sibling `threshold` is a probability (0.6) — so a consumer applying
  the array's own `value >= threshold` rule compared incommensurable units and
  would have flagged almost every change. `value` now carries the modal level's
  probability for both question kinds, and the weighted mean is reported
  explicitly as `headline.expectedLevel` alongside `headline.modalLevel`. The
  verdict logic was already correct and is unchanged; only the published numbers
  were wrong.

Security and fail-closed hardening (pre-merge review pass).

- GitHub Actions: all PR-controlled inputs reach the shell through quoted
  `env:` variables instead of `${{ }}` interpolation in `run:` source
  (command-injection fix); the reusable workflow validates its inputs against
  the triggering pull request, checks out the PR at `refs/pull/<n>/head` as
  data only, verifies the reviewed SHA, requires an explicit trusted
  `bot-ref`, and loads the bot as a local directory action from that trusted
  checkout; reports are written to fresh runner-temporary paths and are never
  read from the PR checkout; checkouts use `persist-credentials: false`.
- Fail-closed: malformed/missing/wrong-typed answers, non-finite or
  out-of-range values, incomplete or non-normalized Score distributions, and
  invalid usage metadata are rejected (`NOT_EVALUATED`), never read as clean;
  response-body text is no longer echoed into error messages; invalid usage
  metadata is no longer copied into reports.
- CLI: a missing change source is a usage error (exit 2); a nonempty input
  that filters to nothing (e.g. everything excluded) is `NOT_EVALUATED`, not
  CLEAN; matched-but-empty specs are `NOT_EVALUATED`; `--block=false` can
  override a repo's `blockOnDrift`; `--version`/`--help` work as flags; git
  diff runs with `--no-ext-diff --no-textconv` and rejects option-looking
  refs so PR-controlled repos cannot execute local diff helpers.
- Payload: PR title/description, repository, refs, and file paths are
  redacted and bounded; the total spec text is bounded by `maxSpecChars`
  including per-file truncation markers; file lists are capped at 100
  entries; the glob walker skips symlinks (loop/escape guard).
- Redaction: assignment keywords match case-insensitively with optional
  quoted values, and scanning is now linear on large inputs (a bounded
  identifier run replaced a quadratic lead). Still best-effort, not proof of
  absence.
- Report: markdown no longer claims "not blocking" when blocking is on; PR
  titles, error reasons, and model strings are redacted, bounded, and
  HTML-escaped before rendering.
- Verdicts: Score levels are keyed by the documented zero-based criterion
  index rather than returned legend wording; a modal Significant-drift/
  Contradiction level below its threshold yields REVIEW instead of CLEAN.
- Tests grew from 46 to 97, including CLI exit-code/report fail-closed
  checks, workflow-shell-injection literals, git-helper execution guards,
  transport timeouts, and redaction performance.

Initial release.

- Jev-backed spec-drift review: five yes/no drift questions plus a headline
  score, evaluated in a single `POST /v1/systemone` call.
- Verdict model: CLEAN / REVIEW / DRIFT, with a fail-closed NOT_EVALUATED
  when Jev cannot be reached.
- Dependency-free TypeScript core (built-in `fetch`); a CLI for local and CI
  use; secret redaction and payload bounding on everything sent to the API.
- GitHub hosting: a composite action, a reusable `workflow_call` workflow for
  other repositories, a self-review dogfood, and a CI gate.
- 46 offline tests, including a process-level integration test against a local
  mock of the Jev API.
