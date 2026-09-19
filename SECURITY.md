# Security

pi-spec-drift sends a slice of your repository to a third-party API
(TypeSafe) in order to get its judgments. This document describes what is sent
and what the bot will never do.

## What leaves the machine

For each review, the request contains the fixed question set, a model alias,
and a structured state containing:

- the task tag and a fixed definition sentence,
- the repository label and branch refs (when run in CI),
- the pull-request title and description (when provided),
- the contents of the files matched by the spec globs,
- the unified diff of the change.

Every one of those strings is **redacted and bounded** before it is sent.

## Redaction

Before transmission, the following are replaced with a `[REDACTED:…]` marker:

- GitHub tokens (`ghp_…`, `gho_…`, `ghs_…`, `ghu_…`),
- AWS access key IDs (`AKIA…`/`ASIA…`),
- `sk-`/`sk_` API keys,
- Slack tokens (`xox…`),
- PEM private-key blocks,
- `Bearer <token>` values,
- JWTs,
- `NAME=value` / `NAME: value` assignments whose name contains
  `KEY`, `TOKEN`, `SECRET`, `PASSWD`, `PASSWORD`, or `CREDENTIAL`
  (case-insensitive, including quoted values).

Redaction is deliberately over-eager but **best effort**. Arbitrary secrets,
encoded values, or unsupported formats may escape pattern matching. Do not
store credentials in reviewed files or PR metadata; inspect dry-run output
before sending sensitive repositories to any third party.

## The API key

- The TypeSafe key is read from `TYPESAFE_API_KEY` (a repository secret in CI,
  an environment variable locally).
- It is placed only in the `Authorization` header of the API call.
- The credential read from the environment is not intentionally copied into
  the state, reports, or logs. If a credential also appears in reviewed content,
  protection depends on best-effort redaction, not a secrecy guarantee.
- If the key is missing, the bot fails closed (§below) rather than running with
  a partial or empty credential.

## Fail-closed

The bot distinguishes *evaluated* from *not evaluated* and treats the latter
as a failure:

- Except for an explicitly supplied empty diff (nothing to review), no key,
  an API error, a timeout, or a malformed/incomplete answer produces a
  `NOT EVALUATED` verdict and a non-zero exit. The bot never claims a PR is
  clean when it could not actually judge it.
- Transient rate-limit (`429`) and overload (`529`) responses are retried with
  exponential backoff before the run is marked not-evaluated.

## Threat model

- **Prompt-injection via the spec or diff.** The state's definition instructs
  the model to treat the spec and diff as data, not instructions. This reduces
  but does not eliminate injection risk; the mitigations that matter most are
  the bounded payload and the fact that the model can only *score* the change,
  not act on it. If you review untrusted forks, prefer `block: "false"` and
  treat bot comments as signals, not commands.
- **The workflow builds only separately checked-out trusted bot source.** PR
  inputs enter shell commands via quoted environment variables, not source
  interpolation. Local actions are loaded from the trusted bot directory, not
  the caller checkout. Git diff disables external/textconv helpers.
- **Trusted refs:** pin both the reusable workflow and required `bot-ref` to the
  same reviewed commit; the latter is executable code with access to the API key.
  Never derive it from the PR. Checkouts disable persisted git credentials.
- **Reports:** fresh files in runner-temporary storage prevent PR-supplied/stale
  report substitution. API error response bodies are not copied into reports.
- **Config/spec tampering:** PR-controlled specs, exclusions, and thresholds can
  influence the judgment. Rejecting all-excluded changes is not a general
  self-approval defense. The bot is advisory, not a tamper-proof security gate.
- **Forks/Dependabot:** normal PR runs may lack API secrets and write tokens.
  We do not elevate them or switch to `pull_request_target`. See
  [GitHub's security guidance](https://docs.github.com/en/actions/reference/security/secure-use).

## Audit

The CLI reports verdict/status; the workflow posts the generated decision
report to the PR when permitted. Raw state and API responses are not logged.
`--dry-run` explicitly displays or saves the best-effort-redacted request state
without calling the API. Reports contain redacted PR metadata and numeric
results; treat their visibility according to repository access controls.
