# Contributing to pi-spec-drift

Thanks for your interest. This is a small, deliberately narrow tool, and the
bar for changes is "does it keep the verdict trustworthy?" — please read
[docs/design.md](docs/design.md) before opening a pull request. That document
is the behavior contract, and the bot reviews its own pull requests against it.

## The one rule that matters

**The spec is authoritative.** If your change alters observable behavior, it
must update `docs/design.md` (and `README.md` where it is user-facing) in the
same pull request. A change that quietly makes the code disagree with the spec
is exactly the drift this project exists to catch — and the bot will say so on
your PR.

If you think the spec is wrong, change the spec, in its own commit, and say why.

## Getting set up

You need **Node 22 or newer** to develop. The test runner uses
`--experimental-strip-types` to run the TypeScript tests directly, which landed
in Node 22.6. (The published `dist/` is plain ES2022 and runs on Node 18+, which
is what `engines` describes — that's a consumer floor, not a contributor one.)

```bash
gh repo fork tylerfloyd/pi-spec-drift --clone   # or fork in the UI and clone
cd pi-spec-drift
npm ci
npm test
```

`npm test` compiles to `dist/` and then runs the suite. It should be green
before you change anything; if it isn't, that's a bug worth reporting on its own.

There are **no runtime dependencies** and there should not be any. The only
devDependencies are TypeScript and `@types/node`. A pull request that adds a
runtime dependency needs to justify it in the description.

## Layout

| path | what lives there |
|---|---|
| `src/` | the whole implementation — client, redaction, glob, state, questions, verdict, report, CLI |
| `test/` | tests, one file per `src/` module, plus `test/fixtures/` |
| `docs/design.md` | the behavior contract (the spec) |
| `action.yml` | the composite action |
| `.github/workflows/spec-drift.yml` | the reusable `workflow_call` other repos invoke |
| `SECURITY.md` | what leaves the machine, and what never does |

## Tests

Tests import from `../dist/`, not `../src/`, so they exercise the built output.
That is why `npm test` builds first.

Please write the test before the fix, and make sure it fails for the right
reason first. A test that passes because the input was rejected earlier in the
pipeline is not a test of your change — that has bitten this repo before.

Use `test/fixtures/` for diffs and specs rather than inlining large strings.
The suite is fully offline: `test/cli.test.ts` and `test/integration.test.ts`
run the real CLI against a local mock of the Jev endpoint, so no API key and
no network access are needed to run or write tests.

## Style

Match what is already there:

- 2-space indentation, TypeScript `strict`, ES modules with `.js` import
  specifiers (NodeNext resolution).
- Comments explain *why*, especially for anything security- or
  calibration-related. Several regexes and thresholds in this repo look
  arbitrary until you read the comment above them — keep that up.
- Don't reformat or "improve" code you aren't otherwise changing.

## Things that need extra care

These areas have caused real bugs; changes here get scrutinised:

- **`src/redact.ts`** — the redaction rules run over the diff and spec, which
  are the *only* evidence the verdict is computed from. Over-matching corrupts
  the model's input just as surely as under-matching leaks a secret. Add cases
  to `test/redact.test.ts` in both directions: the secret is caught, and
  ordinary code is left byte-identical.
- **`src/verdict.ts`** — fail-closed is a guarantee, not a default. Any path
  that can produce `CLEAN` from incomplete or unvalidated input is a bug.
- **Probabilities vs. level indexes** — Jev's Score `score` field is a
  probability-weighted mean over level indexes, not the modal index. Never
  compare it against a probability threshold. See §5 of the design doc.
- **`.github/workflows/`** — inputs from a pull request are untrusted. They
  reach the shell through quoted `env:` variables, never `${{ }}` interpolation
  inside `run:`. Keep it that way.

## Commits

Conventional-commit prefixes, matching the existing history:

```
feat: add X
fix(ci): pin Node 22
fix(report): publish the headline probability
docs: clarify the fork behavior
chore: ...
```

Write the body for someone who will read it in two years with no context: what
was wrong, what it does now, and why that is correct.

## Opening a pull request

1. Branch from `main`, push to your fork, open a PR against `main`.
2. The **`test`** check must pass — it is a required check and nothing merges
   without it.
3. The **spec-drift bot** will review PRs from branches on this repository. It
   is advisory: it comments, and its check does not block a merge.
4. Describe what you changed and why. The bot reads your PR title and
   description as part of the state it judges, so a vague description makes its
   verdict worse, not better.

**If you are contributing from a fork**, the spec-drift check is skipped rather
than run. Fork pull requests do not receive repository secrets, so the bot
cannot reach the Jev API and would fail closed on every outside contribution —
a red check you would have no way to fix. Your PR will be reviewed by hand
instead. This is expected and is not a mark against your change.

A maintainer merges. Only repository collaborators have write access, so please
don't be surprised that you can't merge your own PR even after approval.

## Reporting a security issue

**Don't open a public issue.** See [SECURITY.md](SECURITY.md) for what the bot
sends and what it never does, and report privately via GitHub's security
advisory form on this repository.

## Licence

By contributing you agree that your contributions are licensed under the
MIT Licence, the same terms as the rest of the project. See [LICENSE](LICENSE).
