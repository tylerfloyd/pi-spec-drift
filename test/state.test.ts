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
