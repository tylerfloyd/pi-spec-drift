// End-to-end CLI tests: they spawn the real dist/cli.js the way CI does,
// against a temp repository and (where an API call is needed) a local mock
// of the TypeSafe endpoint. These pin the fail-closed contract at the exit
// code and report-file level.

import { test } from "node:test";
import assert from "node:assert";
import { execFile } from "node:child_process";
import { createServer, type Server } from "node:http";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SCORE_LEVELS } from "../dist/questions.js";

// Report outputs intentionally resolve against cwd; tests pass absolute paths
// so temp-repo outputs cannot contaminate the source checkout.

const root = process.cwd();

function runCli(args: string[], env: Record<string, string> = {}, runCwd?: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    execFile(
      process.execPath,
      ["dist/cli.js", ...args],
      { cwd: runCwd ?? root, env: { ...process.env, TYPESAFE_API_KEY: "", SPEC_DRIFT_BLOCK: "", SPEC_DRIFT_SPEC_GLOB: "", SPEC_DRIFT_MODEL: "", ...env } },
      (err, stdout, stderr) => {
        resolve({ code: err && "code" in err ? (err as any).code : 0, stdout, stderr });
      },
    );
  });
}

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "specdrift-cli-"));
  for (const [name, content] of Object.entries(files)) {
    const p = join(dir, name);
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, content);
  }
  return dir;
}

function startMockJev(drift: boolean): Promise<{ server: Server; url: string; bodies: any[] }> {
  const bodies: any[] = [];
  const legend = Object.fromEntries(SCORE_LEVELS.map((l, i) => [String(i), l]));
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      const parsed = JSON.parse(data);
      bodies.push(parsed);
      const answers = drift
        ? {
            conforms_to_spec: { type: "noul", noul: 0.1 },
            spec_still_accurate: { type: "noul", noul: 0.9 },
            behavior_is_spec_covered: { type: "noul", noul: 0.9 },
            within_stated_scope: { type: "noul", noul: 0.9 },
            intent_matches_diff: { type: "noul", noul: 0.9 },
            drift_level: {
              type: "score",
              score: 2.2,
              legend,
              probabilities: { "0": 0.05, "1": 0.1, "2": 0.8, "3": 0.05 },
              confidence: 0.8,
            },
          }
        : {
            conforms_to_spec: { type: "noul", noul: 0.97 },
            spec_still_accurate: { type: "noul", noul: 0.95 },
            behavior_is_spec_covered: { type: "noul", noul: 0.92 },
            within_stated_scope: { type: "noul", noul: 0.94 },
            intent_matches_diff: { type: "noul", noul: 0.96 },
            drift_level: {
              type: "score",
              score: 0.1,
              legend,
              probabilities: { "0": 0.9, "1": 0.07, "2": 0.02, "3": 0.01 },
              confidence: 0.9,
            },
          };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "jev-latest", answers, usage: { input_tokens: 5, output_tokens: 5 } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}`, bodies });
    });
  });
}

const LOCK_DIFF = `diff --git a/package-lock.json b/package-lock.json
index 1111111..2222222 100644
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,3 +1,3 @@
 {
-  "a": 1
+  "a": 2
 }
`;

const SRC_DIFF = `diff --git a/src/weather.ts b/src/weather.ts
index 1111111..3333333 100644
--- a/src/weather.ts
+++ b/src/weather.ts
@@ -1,2 +1,3 @@
 export function run(city: string) {
+  console.log("extra behavior");
   print(city);
 }
`;

test("review with no change source is a usage error, not a clean pass", async () => {
  const dir = makeRepo({ "spec.md": "the spec" });
  try {
    const { code, stderr } = await runCli(["review", "--root", dir, "--spec-glob", "spec.md"]);
    assert.equal(code, 2, `expected usage error, got ${code}; stderr: ${stderr}`);
    assert.match(stderr, /diff-file|base/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a change that is entirely excluded by excludeGlobs is NOT_EVALUATED", async () => {
  const dir = makeRepo({
    "spec.md": "the spec",
    "exclude.diff": LOCK_DIFF,
  });
  const reportMd = join(dir, "report.md");
  try {
    const { code, stderr } = await runCli(
      ["review", "--root", dir, "--spec-glob", "spec.md", "--diff-file", "exclude.diff", "--report-md", reportMd],
    );
    assert.equal(code, 1, `expected failure, got ${code}; stderr: ${stderr}`);
    const md = readFileSync(reportMd, "utf8");
    assert.ok(md.includes("not evaluated"), md);
    assert.ok(md.toLowerCase().includes("exclud"), `report should say the change was excluded: ${md}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an explicitly provided empty diff stays CLEAN (design contract)", async () => {
  const dir = makeRepo({
    "spec.md": "the spec",
    "empty.diff": "",
  });
  try {
    const { code, stdout } = await runCli(
      ["review", "--root", dir, "--spec-glob", "spec.md", "--diff-file", "empty.diff"],
    );
    assert.equal(code, 0, `expected pass, got ${code}`);
    assert.match(stdout, /no changes|nothing to compare/i);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a matched spec file that is empty is NOT_EVALUATED, even with a key", async () => {
  // a key IS provided, so the only way this run can be NOT_EVALUATED is the
  // empty-spec guard rather than the no-key guard
  const { server, url } = await startMockJev(false);
  const dir = makeRepo({
    "spec.md": "\n   \n",
    "src.diff": SRC_DIFF,
  });
  const reportMd = join(dir, "report.md");
  try {
    const { code } = await runCli(
      ["review", "--root", dir, "--spec-glob", "spec.md", "--diff-file", "src.diff", "--report-md", reportMd],
      { TYPESAFE_API_KEY: "k", SPEC_DRIFT_BASE_URL: url },
    );
    assert.equal(code, 1, `empty spec should fail closed, got ${code}`);
    const md = readFileSync(reportMd, "utf8");
    assert.match(md, /empty/i);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--version and --help exit 0", async () => {
  const v = await runCli(["--version"]);
  assert.equal(v.code, 0, `--version stderr: ${v.stderr}`);
  assert.match(v.stdout, /0\.1\.0/);
  const h = await runCli(["--help"]);
  assert.equal(h.code, 0, `--help stderr: ${h.stderr}`);
  assert.match(h.stdout, /Usage/);
});

test("--block=false keeps the run advisory when the repo config blocks", async () => {
  const { server, url } = await startMockJev(true);
  const dir = makeRepo({
    ".spec-drift.json": JSON.stringify({ specFiles: ["spec.md"], blockOnDrift: true }),
    "spec.md": "the spec",
    "src.diff": SRC_DIFF,
  });
  try {
    const { code, stderr } = await runCli(
      ["review", "--root", dir, "--spec-glob", "spec.md", "--diff-file", "src.diff", "--block=false"],
      { TYPESAFE_API_KEY: "k", SPEC_DRIFT_BASE_URL: url },
    );
    assert.equal(code, 0, `--block=false should override config block, got ${code}; stderr: ${stderr}`);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("config blockOnDrift still blocks when --block is not passed", async () => {
  const { server, url } = await startMockJev(true);
  const dir = makeRepo({
    ".spec-drift.json": JSON.stringify({ specFiles: ["spec.md"], blockOnDrift: true }),
    "spec.md": "the spec",
    "src.diff": SRC_DIFF,
  });
  try {
    const { code } = await runCli(
      ["review", "--root", dir, "--spec-glob", "spec.md", "--diff-file", "src.diff"],
      { TYPESAFE_API_KEY: "k", SPEC_DRIFT_BASE_URL: url },
    );
    assert.equal(code, 1, "repo config blockOnDrift must still fail the run");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hostile PR title/description pass to the payload literally", async () => {
  const { server, url, bodies } = await startMockJev(false);
  const dir = makeRepo({
    "spec.md": "the spec",
    "src.diff": SRC_DIFF,
  });
  const marker = join(tmpdir(), `specdrift-pwned-${process.pid}`);
  try {
    const title = `fix: $(touch ${marker})`;
    const desc = "harmless words `touch " + marker + "` end";
    const { code } = await runCli(
      ["review", "--root", dir, "--spec-glob", "spec.md", "--diff-file", "src.diff", "--pr-title", title, "--pr-desc", desc],
      { TYPESAFE_API_KEY: "k", SPEC_DRIFT_BASE_URL: url },
    );
    assert.equal(code, 0);
    assert.equal(bodies.length, 1);
    // the text reaches the API as inert data: literally, including the shell
    // metacharacters, and no shell ever interprets it
    assert.equal(bodies[0].state.pull_request.title, title);
    assert.equal(bodies[0].state.pull_request.description, desc);
    assert.ok(!existsSync(marker), "command substitution must not execute");
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
    rmSync(marker, { force: true });
  }
});

test("NOT_EVALUATED (no key) still writes a report and exits 1", async () => {
  const dir = makeRepo({
    "spec.md": "the spec",
    "src.diff": SRC_DIFF,
  });
  const reportMd = join(dir, "r.md");
  const reportJson = join(dir, "r.json");
  try {
    const { code } = await runCli(
      ["review", "--root", dir, "--spec-glob", "spec.md", "--diff-file", "src.diff", "--report-md", reportMd, "--report-json", reportJson],
      { TYPESAFE_API_KEY: "" },
    );
    assert.equal(code, 1);
    assert.ok(existsSync(reportMd), "markdown report written even when not evaluated");
    const json = JSON.parse(readFileSync(reportJson, "utf8"));
    assert.equal(json.verdict, "NOT_EVALUATED");
    assert.equal(json.shouldFail, true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
