# Changelog

## Unreleased

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
