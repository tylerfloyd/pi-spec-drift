import { test } from "node:test";
import assert from "node:assert";
import { evaluate, band } from "../dist/verdict.js";
import {
  NOULS,
  SCORE_KEY,
  SCORE_LEVELS,
  DEFAULT_THRESHOLDS,
} from "../dist/questions.js";
import type { NoulAnswer, ScoreAnswer } from "../dist/client.js";

const labels: Record<string, string> = {
  ...Object.fromEntries(NOULS.map((n) => [n.key, n.label])),
  [SCORE_KEY]: "Drift level",
};
const legend: Record<string, string> = Object.fromEntries(
  SCORE_LEVELS.map((l, i) => [String(i), l]),
);

function noul(v: number): NoulAnswer {
  return { type: "noul", noul: v };
}
function score(probs: Record<string, number>, conf = 0.9): ScoreAnswer {
  let s = 0;
  let tot = 0;
  for (const [k, v] of Object.entries(probs)) {
    s += Number(k) * v;
    tot += v;
  }
  return { type: "score", score: tot ? s / tot : 0, legend, probabilities: probs, confidence: conf };
}
function baseAnswers(): Record<string, NoulAnswer | ScoreAnswer> {
  return {
    conforms_to_spec: noul(0.95),
    spec_still_accurate: noul(0.9),
    behavior_is_spec_covered: noul(0.9),
    within_stated_scope: noul(0.9),
    intent_matches_diff: noul(0.9),
    [SCORE_KEY]: score({ "0": 0.9, "1": 0.08, "2": 0.01, "3": 0.01 }),
  };
}
const opts = { thresholds: DEFAULT_THRESHOLDS, labels };

test("band: boundaries classify correctly", () => {
  assert.equal(band(0.9, 0.8), "satisfied");
  assert.equal(band(0.8, 0.8), "satisfied"); // p >= t
  assert.equal(band(0.5, 0.8), "unclear");
  assert.equal(band(0.21, 0.8), "unclear");
  assert.equal(band(0.2, 0.8), "violated"); // p <= 1 - t
  assert.equal(band(0.0, 0.8), "violated");
});

test("all-clean answers -> CLEAN", () => {
  const ev = evaluate({ ...opts, answers: baseAnswers(), evaluated: true });
  assert.equal(ev.verdict, "CLEAN");
  assert.ok(ev.headline?.label.startsWith("No drift"));
});

test("high-drift headline alone -> DRIFT", () => {
  const a = baseAnswers();
  a[SCORE_KEY] = score({ "0": 0.2, "1": 0.05, "2": 0.7, "3": 0.05 });
  const ev = evaluate({ ...opts, answers: a, evaluated: true });
  assert.equal(ev.verdict, "DRIFT");
  assert.ok(ev.headline?.label.startsWith("Significant drift"));
});

test("a violated noul alone -> DRIFT", () => {
  const a = baseAnswers();
  a.behavior_is_spec_covered = noul(0.15); // below 1 - 0.8
  const ev = evaluate({ ...opts, answers: a, evaluated: true });
  assert.equal(ev.verdict, "DRIFT");
  const flagged = ev.noulResults.find((n) => n.key === "behavior_is_spec_covered");
  assert.equal(flagged?.band, "violated");
});

test("an unclear noul with no violation -> REVIEW", () => {
  const a = baseAnswers();
  a.conforms_to_spec = noul(0.5); // middle band for t=0.8
  a[SCORE_KEY] = score({ "0": 0.4, "1": 0.6, "2": 0, "3": 0 }); // minor drift, not a drift headline
  const ev = evaluate({ ...opts, answers: a, evaluated: true });
  assert.equal(ev.verdict, "REVIEW");
});

test("minor-drift headline does not by itself DRIFT", () => {
  const a = baseAnswers();
  a[SCORE_KEY] = score({ "0": 0.35, "1": 0.65, "2": 0, "3": 0 });
  const ev = evaluate({ ...opts, answers: a, evaluated: true });
  assert.equal(ev.verdict, "REVIEW"); // uncertain band / minor -> review, not drift
});

test("evaluated=false short-circuits to NOT_EVALUATED", () => {
  const ev = evaluate({
    thresholds: DEFAULT_THRESHOLDS,
    labels,
    evaluated: false, reason: "no TYPESAFE_API_KEY",
  });
  assert.equal(ev.verdict, "NOT_EVALUATED");
  assert.equal(ev.reason, "no TYPESAFE_API_KEY");
});

test("usage and model are carried through", () => {
  const ev = evaluate({
    ...opts,
    answers: baseAnswers(),
    evaluated: true,
    usage: { input_tokens: 100, output_tokens: 20 },
    model: "jev-latest",
  });
  assert.deepEqual(ev.usage, { input_tokens: 100, output_tokens: 20 });
  assert.equal(ev.model, "jev-latest");
});
