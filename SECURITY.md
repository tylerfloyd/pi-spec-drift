# Security

pi-spec-drift sends a slice of your repository to a third-party API
(TypeSafe) in order to get its judgments. This document describes what is sent
and what the bot will never do.

## What leaves the machine

For each review, the request body contains only:

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
- `NAME=value` / `NAME: value` assignments whose name ends in
  `KEY`, `TOKEN`, `SECRET`, `PASSWD`, `PASSWORD`, or `CREDENTIAL`.

Redaction is deliberately over-eager: missing a real secret is the only
failure that matters, and a false positive just costs a bit of context.

## The API key

- The TypeSafe key is read from `TYPESAFE_API_KEY` (a repository secret in CI,
  an environment variable locally).
- It is placed only in the `Authorization` header of the API call.
- It is **never** written into the state payload, the report, the logs, or any
  committed file.
- If the key is missing, the bot fails closed (§below) rather than running with
  a partial or empty credential.

## Fail-closed

The bot distinguishes *evaluated* from *not evaluated* and treats the latter
as a failure:

- No key, an API error, a timeout, or a malformed/incomplete answer produces a
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
- **The bot does not run the changed code**, so a malicious diff cannot
  execute on the review runner beyond what `git` and the (separate) CI steps
  already do.

## Audit

The review's input/output is logged to the workflow run's logs (redacted
payload, returned probabilities). Nothing is exfiltrated beyond the TypeSafe
API call itself.
