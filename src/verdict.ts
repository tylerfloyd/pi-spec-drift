// Turn raw Jev answers into a drift verdict.
//
// Band model (per threshold t, 0.5 < t <= 1):
//   satisfied  p >= t
//   violated   p <= 1 - t
//   unclear    1 - t < p < t
//
// We phrase every Noul so high = clean. So a "violated" band (very low
// probability) is the drift signal for that dimension; "unclear" is the
// "Jev is not sure — a human should look". The headline Score is an
// independent signal: a high-drift level at a confident probability also
// escalates to DRIFT.

import type { NoulAnswer, ScoreAnswer } from "./client.js";
import { DRIFT_HEADLINES, SCORE_KEY } from "./questions.js";

export type Band = "satisfied" | "violated" | "unclear";
export type Verdict = "CLEAN" | "REVIEW" | "DRIFT" | "NOT_EVALUATED";

export interface NoulResult {
  key: string;
  label: string;
  kind: "noul";
  p: number;
  threshold: number;
  band: Band;
}

export interface HeadlineResult {
  key: string;
  kind: "score";
  value: number;
  label: string;
  levelProbability: number;
  confidence: number;
  threshold: number;
  distribution: Record<string, number>;
}

export interface Evaluation {
  verdict: Verdict;
  evaluated: boolean;
  questions: (NoulResult | HeadlineResult)[];
  noulResults: NoulResult[];
  headline?: HeadlineResult;
  usage?: { input_tokens: number; output_tokens: number };
  model?: string;
  reason?: string;
}

export function band(p: number, t: number): Band {
  // Round to 1e-6 first: 1 - 0.8 is 0.19999… in IEEE-754, and a boundary
  // probability must land in the violated band, not leak into unclear.
  const r = (x: number) => Math.round(x * 1e6) / 1e6;
  const pr = r(p);
  if (pr >= r(t)) return "satisfied";
  if (pr <= r(1 - t)) return "violated";
  return "unclear";
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export interface EvaluateInput {
  answers: Record<string, NoulAnswer | ScoreAnswer>;
  thresholds: Record<string, number>;
  labels: Record<string, string>;
  evaluated: boolean;
  usage?: { input_tokens: number; output_tokens: number };
  model?: string;
  reason?: string;
}

export function evaluate(input: EvaluateInput): Evaluation {
  const { answers, thresholds, labels } = input;

  if (!input.evaluated) {
    return {
      verdict: "NOT_EVALUATED",
      evaluated: false,
      questions: [],
      noulResults: [],
      reason: input.reason,
      model: input.model,
      usage: input.usage,
    };
  }

  const noulResults: NoulResult[] = [];
  let anyViolated = false;
  let anyUnclear = false;

  for (const [key, answer] of Object.entries(answers)) {
    if (answer.type !== "noul") continue;
    const p = clamp01((answer as NoulAnswer).noul);
    const t = thresholds[key];
    if (t === undefined) continue;
    const b = band(p, t);
    if (b === "violated") anyViolated = true;
    if (b === "unclear") anyUnclear = true;
    noulResults.push({
      key,
      label: labels[key] ?? key,
      kind: "noul",
      p: round3(p),
      threshold: t,
      band: b,
    });
  }

  let headline: HeadlineResult | undefined;
  let headlineDrift = false;
  const scoreAnswer = answers[SCORE_KEY];
  if (scoreAnswer && scoreAnswer.type === "score") {
    const sa = scoreAnswer as ScoreAnswer;
    const probs = sa.probabilities;
    let topLevel = "";
    let topProb = -1;
    for (const [level, prob] of Object.entries(probs)) {
      const p = Number(prob);
      if (isFinite(p) && p > topProb) {
        topProb = p;
        topLevel = level;
      }
    }
    const label = sa.legend[topLevel] ?? topLevel;
    const shortLabel = shortScoreLabel(label);
    if (DRIFT_HEADLINES.has(shortLabel) && topProb >= thresholds[SCORE_KEY]) {
      headlineDrift = true;
    }
    headline = {
      key: SCORE_KEY,
      kind: "score",
      value: round3(sa.score),
      label: shortLabel,
      levelProbability: round3(topProb),
      confidence: round3(sa.confidence),
      threshold: thresholds[SCORE_KEY] ?? 0.6,
      distribution: Object.fromEntries(
        Object.entries(probs).map(([k, v]) => [sa.legend[k] ?? k, round3(Number(v))]),
      ),
    };
  }

  let verdict: Verdict;
  const minorDrift = headline?.label.startsWith("Minor drift");
  if (anyViolated || headlineDrift) verdict = "DRIFT";
  else if (anyUnclear || minorDrift) verdict = "REVIEW";
  else verdict = "CLEAN";

  const questions: (NoulResult | HeadlineResult)[] = [...noulResults];
  if (headline) questions.push(headline);

  return {
    verdict,
    evaluated: true,
    questions,
    noulResults,
    headline,
    usage: input.usage,
    model: input.model,
    reason: input.reason,
  };
}

function shortScoreLabel(label: string): string {
  // Legend strings are "Level: description". We match on the level word.
  for (const key of ["No drift", "Minor drift", "Significant drift", "Contradiction"]) {
    if (label.startsWith(key)) return key;
  }
  return label;
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}
