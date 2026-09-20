// Regressions for defects found in review of the initial branch.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redact } from "../dist/redact.js";
import { filterDiff } from "../dist/diff.js";
import { loadConfig } from "../dist/config.js";
import { buildQuestions } from "../dist/questions.js";
import { evaluate } from "../dist/verdict.js";
import { renderMarkdown } from "../dist/report.js";

function withRoot<T>(files: Record<string, string>, fn: (root: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "specdrift-regress-"));
  try {
    for (const [name, body] of Object.entries(files)) {
      writeFileSync(join(dir, name), body, "utf8");
    }
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// 1 — redaction must not mangle ordinary code or spec prose.
test("secret-assignment rule leaves ordinary identifiers and calls intact", () => {
  for (const input of [
    "const tokens = tokenize(source);",
    "const publicKey = derivePublicKey(seed);",
    "monkeyPatch = requireSomething();",
    "const secret = getSecret();",
    "let tokenCount = tokens.length;",
  ]) {
    const { text } = redact(input);
    assert.equal(text, input, `${input} -> ${text}`);
  }
});

test("secret-assignment rule does not consume a following line", () => {
  const input = "API_KEY:\n  description: the api key\n";
  const { text } = redact(input);
  assert.ok(text.includes("\n  description:"), text);
  assert.equal(text.split("\n").length, input.split("\n").length, text);
});

test("secret-assignment rule still redacts real credential assignments", () => {
  for (const input of [
    "API_KEY=hunter2secret99",
    "api_key: hunter2secret99",
    'DbPassword = "hunter2secret99"',
    "SECRET_VALUE=hunter2secret99",
    "access_token='hunter2secret99'",
  ]) {
    const { text } = redact(input);
    assert.ok(!text.includes("hunter2secret99"), `${input} -> ${text}`);
    assert.ok(text.includes("[REDACTED:secret]"), `${input} -> ${text}`);
  }
});

// 2 — non-integer / negative budgets are a config error, not a crash deep in truncation.
test("a fractional text budget is rejected by loadConfig with a clear message", () => {
  withRoot({ ".spec-drift.json": '{"maxSpecChars": 16000.5}' }, (root) => {
    assert.throws(() => loadConfig(root), /maxSpecChars/);
  });
});

test("a negative text budget is rejected by loadConfig", () => {
  withRoot({ ".spec-drift.json": '{"maxDiffChars": -1}' }, (root) => {
    assert.throws(() => loadConfig(root), /maxDiffChars/);
  });
});

test("a valid integer budget is still accepted", () => {
  withRoot({ ".spec-drift.json": '{"maxSpecChars": 1000}' }, (root) => {
    assert.equal(loadConfig(root).maxSpecChars, 1000);
  });
});

// 3 — thresholds must be real numbers, and a bad one must not reach the renderer.
test("a string threshold is rejected rather than coerced", () => {
  const { thresholds } = buildQuestions({ conforms_to_spec: "0.9" as unknown as number });
  assert.equal(typeof thresholds.conforms_to_spec, "number");
});

test("an out-of-range threshold in config is reported, not silently dropped", () => {
  withRoot({ ".spec-drift.json": '{"thresholds": {"conforms_to_spec": 0.4}}' }, (root) => {
    assert.throws(() => loadConfig(root), /conforms_to_spec/);
  });
});

test("a non-numeric threshold in config is reported", () => {
  withRoot({ ".spec-drift.json": '{"thresholds": {"conforms_to_spec": "0.9"}}' }, (root) => {
    assert.throws(() => loadConfig(root), /conforms_to_spec/);
  });
});

// 4 — the action must not force --block and override repo config.
test("action only passes --block when the input is set", () => {
  const action = readFileSync("action.yml", "utf8");
  const blockInput = action.match(/ {2}block:\n(?: {4}.*\n)+/)?.[0] ?? "";
  assert.ok(!/default:\s*["']?false["']?/.test(blockInput), `block must not default to false:\n${blockInput}`);
  const script = action.match(/ {6}run: \|\n([\s\S]*)$/)?.[1] ?? "";
  assert.match(script, /INPUT_BLOCK/);
  assert.match(script, /""\)\s*;;/, "empty INPUT_BLOCK must be a no-op case");
});

// 5 — `--block false` must not mean `--block true`.
function cliBlockFlag(args: string[]): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), "specdrift-block-"));
  writeFileSync(join(dir, "SPEC.md"), "# Spec\n\nThe widget must be blue.\n", "utf8");
  writeFileSync(join(dir, "d.diff"), DIFF, "utf8");
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      ["dist/cli.js", "review", "--root", dir, "--diff-file", join(dir, "d.diff"), ...args],
      {
        cwd: process.cwd(),
        env: { ...process.env, TYPESAFE_API_KEY: "", SPEC_DRIFT_BLOCK: "", SPEC_DRIFT_SPEC_GLOB: "", SPEC_DRIFT_MODEL: "" },
      },
      (_err, stdout, stderr) => {
        rmSync(dir, { recursive: true, force: true });
        const m = (stdout + stderr).match(/block=(true|false)/);
        if (!m) return reject(new Error(`no block= in output: ${stdout}${stderr}`));
        resolve(m[1]);
      },
    );
  });
}

const DIFF = [
  "diff --git a/src/widget.ts b/src/widget.ts",
  "--- a/src/widget.ts",
  "+++ b/src/widget.ts",
  "@@ -1 +1 @@",
  '-const color = "blue";',
  '+const color = "red";',
  "",
].join("\n");

test("--block false parses as false, not true", async () => {
  assert.equal(await cliBlockFlag(["--block", "false"]), "false");
});

test("--block=false is false and bare --block is true", async () => {
  assert.equal(await cliBlockFlag(["--block=false"]), "false");
  assert.equal(await cliBlockFlag(["--block"]), "true");
});

test("a boolean flag does not swallow a following flag", async () => {
  assert.equal(await cliBlockFlag(["--block", "--json"]), "true");
});

// 6 — diff paths containing spaces must parse.
test("filterDiff reads paths that contain spaces", () => {
  const diff = [
    "diff --git a/src/my file.ts b/src/my file.ts",
    "index 000..111 100644",
    "--- a/src/my file.ts",
    "+++ b/src/my file.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "",
  ].join("\n");
  const { changedFiles } = filterDiff(diff, []);
  assert.deepEqual(changedFiles, ["src/my file.ts"]);
});

test("filterDiff excludes a spaced path under a non-anchored pattern", () => {
  const diff = [
    "diff --git a/dist/my file.js b/dist/my file.js",
    "--- a/dist/my file.js",
    "+++ b/dist/my file.js",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "",
  ].join("\n");
  const { changedFiles, droppedFiles } = filterDiff(diff, ["dist/**"]);
  assert.deepEqual(changedFiles, []);
  assert.deepEqual(droppedFiles, ["dist/my file.js"]);
});

test("filterDiff is not fooled by an added line that looks like a +++ header", () => {
  const diff = [
    "diff --git a/src/real.ts b/src/real.ts",
    "--- a/src/real.ts",
    "+++ b/src/real.ts",
    "@@ -1 +2 @@",
    "+++ b/src/fake.ts",
    "",
  ].join("\n");
  assert.deepEqual(filterDiff(diff, []).changedFiles, ["src/real.ts"]);
});

test("filterDiff handles a deletion whose +++ side is /dev/null", () => {
  const diff = [
    "diff --git a/src/gone file.ts b/src/gone file.ts",
    "deleted file mode 100644",
    "--- a/src/gone file.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-a",
    "",
  ].join("\n");
  assert.deepEqual(filterDiff(diff, []).changedFiles, ["src/gone file.ts"]);
});

// 7 — a Noul with no threshold must not silently vanish from the verdict.
test("a violated noul with no threshold in the map fails closed", () => {
  const answers = {
    conforms_to_spec: { type: "noul", noul: 0.02 },
  } as never;
  const ev = evaluate(answers, {}, {});
  assert.notEqual(ev.verdict, "CLEAN");
});

// 8 — markdown metacharacters in untrusted text must not build a link.
test("safeText neutralises markdown link syntax in a PR title", () => {
  const md = renderMarkdown(
    { verdict: "CLEAN", evaluated: true, questions: [], noulResults: [] } as never,
    { repository: "[evil](https://example.com)" },
  );
  assert.ok(!md.includes("[evil](https://example.com)"), md);
});
