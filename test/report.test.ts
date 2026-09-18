import { test } from "node:test";
import assert from "node:assert";
import { renderMarkdown, renderJson } from "../dist/report.js";
import type { Evaluation, NoulResult } from "../dist/verdict.js";

const meta = {
  repository: "tylerfloyd/pi-spec-drift",
  prTitle: "Add humidity output",
  specFiles: ["spec.md"],
  changedFiles: ["src/weather.ts"],
};

function clean(): Evaluation {
  return { verdict: "CLEAN", evaluated: true, questions: [], noulResults: [] };
}
function drift(): Evaluation {
  const nr: NoulResult = {
    key: "conforms_to_spec",
    label: "Conforms to spec",
    kind: "noul",
    p: 0.2,
    threshold: 0.8,
    band: "violated",
  };
  return {
    verdict: "DRIFT",
    evaluated: true,
    questions: [nr],
    noulResults: [nr],
  };
}
function notEval(reason: string): Evaluation {
  return { verdict: "NOT_EVALUATED", evaluated: false, questions: [], noulResults: [], reason };
}

test("renderJson: CLEAN never fails the check", () => {
  const doc = JSON.parse(renderJson(clean(), false, meta));
  assert.equal(doc.verdict, "CLEAN");
  assert.equal(doc.shouldFail, false);
});

test("renderJson: DRIFT fails only when blocking", () => {
  assert.equal(JSON.parse(renderJson(drift(), true, meta)).shouldFail, true);
  assert.equal(JSON.parse(renderJson(drift(), false, meta)).shouldFail, false);
});

test("renderJson: NOT_EVALUATED always fails (fail closed)", () => {
  assert.equal(JSON.parse(renderJson(notEval("no key"), false, meta)).shouldFail, true);
});

test("renderMarkdown: DRIFT badge, table, and flagged list", () => {
  const md = renderMarkdown(drift(), meta);
  assert.ok(md.includes("drift detected"));
  assert.ok(md.includes("| dimension |"));
  assert.ok(md.includes("Flagged:"));
  assert.ok(md.includes("conforms_to_spec"));
});

test("renderMarkdown: NOT_EVALUATED explains and does not claim clean", () => {
  const md = renderMarkdown(notEval("no TYPESAFE_API_KEY is set"), meta);
  assert.ok(md.includes("not evaluated"));
  assert.ok(md.includes("no TYPESAFE_API_KEY is set"));
  assert.ok(!md.includes("no drift"));
});

test("renderMarkdown: CLEAN reads as all clear", () => {
  const md = renderMarkdown(clean(), meta);
  assert.ok(md.includes("no drift"));
});
