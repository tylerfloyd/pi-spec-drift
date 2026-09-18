# Changelog

## Unreleased

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
