import { test } from "node:test";
import assert from "node:assert";
import { buildState } from "../dist/state.js";

test("labels spec and change sections", () => {
  const s = buildState({
    specFiles: [{ path: "spec.md", content: "the spec text" }],
    diff: "diff --git a/x b/x",
    changedFiles: ["x"],
  });
  assert.equal(s.task, "spec_drift_review");
  assert.ok(s.spec.content.includes("### FILE: spec.md"));
  assert.ok(s.spec.content.includes("the spec text"));
  assert.deepEqual(s.change.files, ["x"]);
});

test("redacts secrets in diff and spec before sending", () => {
  const s = buildState({
    specFiles: [{ path: "spec.md", content: "key ghp_1234567890abcdef1234567890abcdef" }],
    diff: "curl -H 'Authorization: Bearer abcdef0123456789xyz'",
  });
  assert.ok(s.spec.content.includes("[REDACTED:github-token]"));
  assert.ok(!s.spec.content.includes("ghp_1234567890abcdef"));
  assert.ok(s.change.diff.includes("Bearer [REDACTED:token]"));
  assert.ok(!s.change.diff.includes("abcdef0123456789xyz"));
});

test("redacts the PR description too into the payload", () => {
  const s = buildState({
    specFiles: [],
    diff: "diff",
    pr: { title: "t", description: "token gho_1234567890abcdef1234567890abcdef" },
  });
  assert.ok(s.pull_request?.description?.includes("[REDACTED:github-token]"));
});

test("bounds large diff and spec by their budgets", () => {
  const big = "x".repeat(5000);
  const s = buildState({
    specFiles: [{ path: "spec.md", content: big }],
    diff: big,
    maxSpecChars: 100,
    maxDiffChars: 100,
  });
  assert.ok(s.change.diff.includes("[truncated"));
  assert.ok(s.spec.content.includes("[truncated"));
  assert.ok(s.change.diff.length < big.length);
});

test("empty spec yields a placeholder", () => {
  const s = buildState({ specFiles: [], diff: "diff" });
  assert.ok(s.spec.content.includes("no spec content"));
});

test("redacts and bounds the PR title in the payload", () => {
  const s = buildState({
    specFiles: [],
    diff: "diff",
    pr: { title: "fix: ghp_1234567890abcdef1234567890abcdef " + "x".repeat(500) },
  });
  const title = s.pull_request?.title ?? "";
  assert.ok(!title.includes("ghp_1234567890abcdef"), `title not redacted: ${title.slice(-60)}`);
  assert.ok(title.length < 400, `title not bounded: ${title.length}`);
});

test("bounds the PR description in the payload", () => {
  const s = buildState({
    specFiles: [],
    diff: "diff",
    pr: { description: "y".repeat(20000) },
  });
  const desc = s.pull_request?.description ?? "";
  assert.ok(desc.length < 20000, `description not bounded: ${desc.length}`);
});

test("spec budget is shared across files, not multiplied by the per-file floor", () => {
  const files = Array.from({ length: 10 }, (_, i) => ({
    path: `s${i}.md`,
    content: "z".repeat(1000),
  }));
  const s = buildState({ specFiles: files, diff: "diff", maxSpecChars: 1000 });
  // 10 files share the 1000-char budget; the old max(2000, ...) floor let
  // this grow to ~20k chars. Allow some headroom for the truncation markers
  // and file headers, but nowhere near 2x the budget.
  assert.ok(s.spec.content.length <= 1000 + 10 * 60, `got ${s.spec.content.length}`);
  assert.ok(s.spec.content.includes("[truncated"), "each over-budget file is truncated");
});

test("redacts secret-looking text in spec file paths", () => {
  const s = buildState({
    specFiles: [{ path: "specs/ghp_1234567890abcdef1234567890abcdef.md", content: "text" }],
    diff: "diff",
  });
  assert.ok(!s.spec.content.includes("ghp_1234567890abcdef"), s.spec.content);
  assert.ok(!s.spec.files.join(",").includes("ghp_1234567890abcdef"), s.spec.files.join(","));
});
