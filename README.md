# pi-spec-drift

A **spec-drift review bot** for [Pi](https://pi.dev), backed by
[Jev](https://typesafe.ai) (TypeSafe's decision-only model).

It watches a change — a pull-request diff — against your written spec and
tells you, with calibrated probabilities, whether the code and the spec have
drifted apart. It runs as a GitHub bot and posts an advisory review to the PR.

pi-spec-drift is **your** tool: the question set, the verdict model, and the
fail-closed guarantees below are the spec that this repository holds itself to.
See [docs/design.md](docs/design.md) for the authoritative behavior contract.

## Why

Code and specs drift apart. A change might quietly do something the spec never
promised, or fix a bug in a way that makes the spec stale. A human reviewer
scanning a diff can miss both. Jev does not write prose — it returns a
calibrated probability (0.0–1.0) for each yes/no question you ask, in a few
hundred milliseconds. pi-spec-drift asks it a fixed set of drift questions and
turns the probabilities into a verdict a human can act on.

## What it does

On each pull request, the bot:

1. Checks out the PR's head and computes the diff against its base.
2. Reads the files your repo designates as *the spec* (a configurable glob).
3. Builds a bounded state — the PR title/description, the diff, and the spec —
   and **redacts obvious secrets** before anything leaves the machine.
4. Asks Jev five yes/no drift questions plus one headline score, all in a
   single API call.
5. Maps the returned probabilities into a verdict and posts it to the PR.

### The drift questions

Each is phrased so a **high** probability means *clean* for that dimension:

| key | asks (high = yes) |
|---|---|
| `conforms_to_spec` | the changed code is consistent with, and doesn't contradict, the spec |
| `spec_still_accurate` | after the change the spec still describes the system correctly |
| `behavior_is_spec_covered` | every new/changed behavior is described in the spec |
| `within_stated_scope` | the change stays within the spec + the PR's stated purpose |
| `intent_matches_diff` | the diff does what the PR title/description claim |
| `drift_level` *(score)* | a single headline: No drift · Minor drift · Significant drift · Contradiction |

### Verdicts

| verdict | meaning | CI effect |
|---|---|---|
| ✅ **CLEAN** | all dimensions clearly satisfied, headline says no drift | check passes |
| ⚠️ **REVIEW** | nothing clearly violated, but a dimension is in the uncertain band or the headline is *Minor drift* | check passes (advisory) |
| 🔴 **DRIFT** | a dimension is clearly violated, or the headline is *Significant drift/Contradiction* at a confident probability | passes by default; **fails if `block` is on** |
| ⛔ **NOT EVALUATED** | Jev was not reached (no key, network/API error) | **always fails** — the bot never treats an unevaluated PR as clean |

The per-question bands are: *satisfied* `p ≥ t`, *violated* `p ≤ 1 − t`,
*unclear* in between, where `t` is that question's threshold.

## How to use it in a repo

**1. Add your API key as a repository secret** named `TYPESAFE_API_KEY`
(Repositories → Settings → Secrets and variables → Actions). Get a key from
the [TypeSafe console](https://console.typesafe.ai/settings/keys). The key is
used only to call the API; it is never printed or committed.

**2. Tell the bot which files are the spec.** Either add a `.spec-drift.json`
to your repo root, or pass the glob in the workflow (see below). Default
globs: `PRODUCT.md`, `TECH.md`, `SPEC.md`, `docs/spec*.md`.

**3. Invoke the reusable workflow.** Add this to `.github/workflows/`:

```yaml
name: Spec Drift
on:
  pull_request:
    types: [opened, synchronize, reopened, edited]
jobs:
  spec-drift:
    permissions:
      pull-requests: write
    uses: tylerfloyd/pi-spec-drift/.github/workflows/spec-drift.yml@main
    secrets:
      TYPESAFE_API_KEY: ${{ secrets.TYPESAFE_API_KEY }}
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    with:
      owner: ${{ github.event.pull_request.base.repo.owner.login }}
      repo: ${{ github.event.pull_request.base.repo.name }}
      pr-number: ${{ github.event.pull_request.number }}
      base: ${{ github.event.pull_request.base.sha }}
      head: ${{ github.event.pull_request.head.sha }}
      pr-title: ${{ github.event.pull_request.title }}
      pr-desc: ${{ github.event.pull_request.body }}
      spec-glob: "PRODUCT.md,TECH.md,docs/spec*.md"
      block: "false"
```

Pin `@main` to a tag (e.g. `@v1`) to freeze the bot version. Pass
`block: "true"` to make clear drift fail the check instead of just commenting.

## Configuration

`.spec-drift.json` (repo root) — every field optional:

```json
{
  "specFiles": ["PRODUCT.md", "docs/spec*.md"],
  "excludeGlobs": ["**/*lock", "**/dist/**"],
  "model": "jev-latest",
  "blockOnDrift": false,
  "maxSpecChars": 16000,
  "maxDiffChars": 24000,
  "thresholds": {
    "conforms_to_spec": 0.8,
    "spec_still_accurate": 0.85
  }
}
```

Precedence: CLI flags > environment > `.spec-drift.json` > defaults.

Environment variables: `TYPESAFE_API_KEY` (required to evaluate),
`SPEC_DRIFT_BLOCK=1` (enable blocking), `SPEC_DRIFT_SPEC_GLOB` (globs),
`SPEC_DRIFT_MODEL`, `SPEC_DRIFT_BASE_URL` (override the API base URL).

## Run it locally

```sh
export TYPESAFE_API_KEY=...
npm ci && npm run build

# review a branch against main
node dist/cli.js review --base main --head HEAD --spec-glob "docs/spec*.md"

# or review a saved diff
node dist/cli.js review --diff-file changes.diff --spec-glob "PRODUCT.md"

# inspect the exact payload without calling the API
node dist/cli.js review --diff-file changes.diff --dry-run
```

Without `TYPESAFE_API_KEY` set, the run prints a `NOT EVALUATED` report and
exits non-zero — it will not guess.

## Tuning thresholds

The defaults are starting points, not measured truth. If a PR you expect to be
clean gets flagged, or a drift you expect to catch slips through, retune the
threshold for that dimension in `.spec-drift.json`. Move thresholds
deliberately: the band between `1 − t` and `t` is the *uncertain* region, and
pushing `t` up **narrows** the violated region on the low end. The right fix is
usually to rephrase the question, not to nudge the number.

## Security model

See [SECURITY.md](SECURITY.md). In short: only the PR title/description, the
diff, and the matched spec are sent to TypeSafe, all **redacted and bounded**;
the API key is a repository secret never printed; and when Jev cannot be
reached the bot **fails closed** rather than approving.

## License

MIT. See [LICENSE](LICENSE).
