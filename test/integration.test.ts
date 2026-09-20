import { test } from "node:test";
import assert from "node:assert";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { type AddressInfo } from "node:net";
import { cwd } from "node:process";
import { SCORE_LEVELS } from "../dist/questions.js";

const root = cwd();

function startMockJev(drift: boolean): Promise<{ server: Server; url: string; reqs: Array<{ auth?: string; body: any }> }> {
  const reqs: Array<{ auth?: string; body: any }> = [];
  const legend = Object.fromEntries(SCORE_LEVELS.map((l, i) => [String(i), l]));
  const server = createServer((req, res) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      reqs.push({ auth: req.headers.authorization, body: JSON.parse(data) });
      const answers = drift
        ? {
            conforms_to_spec: { type: "noul", noul: 0.18 },
            spec_still_accurate: { type: "noul", noul: 0.25 },
            behavior_is_spec_covered: { type: "noul", noul: 0.15 },
            within_stated_scope: { type: "noul", noul: 0.9 },
            intent_matches_diff: { type: "noul", noul: 0.9 },
            drift_level: {
              type: "score",
              score: 2.1,
              legend,
              probabilities: { "0": 0.05, "1": 0.15, "2": 0.7, "3": 0.1 },
              confidence: 0.7,
            },
          }
        : {
            conforms_to_spec: { type: "noul", noul: 0.96 },
            spec_still_accurate: { type: "noul", noul: 0.92 },
            behavior_is_spec_covered: { type: "noul", noul: 0.9 },
            within_stated_scope: { type: "noul", noul: 0.93 },
            intent_matches_diff: { type: "noul", noul: 0.95 },
            drift_level: {
              type: "score",
              score: 0.1,
              legend,
              probabilities: { "0": 0.9, "1": 0.08, "2": 0.01, "3": 0.01 },
              confidence: 0.9,
            },
          };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ model: "jev-latest", answers, usage: { input_tokens: 120, output_tokens: 18 } }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      resolve({ server, url: `http://127.0.0.1:${port}`, reqs });
    });
  });
}

function runCli(args: string[], env: Record<string, string>) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
    const child = execFile(
      process.execPath,
      ["dist/cli.js", "review", ...args],
      { cwd: root, env: { ...process.env, ...env } },
      (err, stdout, stderr) => {
        resolve({ code: err && "code" in err ? (err as any).code : 0, stdout, stderr });
      },
    );
  });
}

test("full pipeline against a mocked Jev API detects drift", async () => {
  const { server, url, reqs } = await startMockJev(true);
  try {
    const { code, stdout } = await runCli(
      ["--diff-file", "test/fixtures/drift.diff", "--spec-glob", "test/fixtures/spec.md", "--pr-title", "Add --watch mode", "--pr-desc", "Polls the provider"],
      { TYPESAFE_API_KEY: "test-key-123", SPEC_DRIFT_BASE_URL: url },
    );
    // not blocking by default, so drift is reported but the run passes
    assert.equal(code, 0);
    assert.ok(stdout.includes("drift detected"), "report should flag drift");
    assert.ok(stdout.includes("conforms_to_spec"), "report should list the flagged dimension");

    // the client sent a well-formed payload over the real (local) transport
    assert.equal(reqs.length, 1);
    assert.equal(reqs[0].auth, "Bearer test-key-123");
    assert.equal(reqs[0].body.model, "jev-latest");
    assert.equal(reqs[0].body.state.task, "spec_drift_review");
    assert.deepEqual(reqs[0].body.state.spec.files, ["test/fixtures/spec.md"]);
    assert.ok(reqs[0].body.state.change.diff.includes("--watch"));
    for (const k of ["conforms_to_spec", "spec_still_accurate", "behavior_is_spec_covered", "within_stated_scope", "intent_matches_diff", "drift_level"]) {
      assert.ok(reqs[0].body.questions[k], `question ${k} sent`);
    }
  } finally {
    server.close();
  }
});

test("full pipeline reports clean when Jev says so", async () => {
  const { server, url } = await startMockJev(false);
  try {
    const { code, stdout } = await runCli(
      ["--diff-file", "test/fixtures/clean.diff", "--spec-glob", "test/fixtures/spec.md"],
      { TYPESAFE_API_KEY: "test-key-123", SPEC_DRIFT_BASE_URL: url },
    );
    assert.equal(code, 0);
    assert.ok(stdout.includes("no drift"));
  } finally {
    server.close();
  }
});
