// The spec-drift question set.
//
// Each Noul is phrased so a HIGH probability means "clean / no problem" for
// that dimension. A low probability is the drift signal. One Score gives a
// single headline across the whole change. Thresholds are starting points,
// not truth: the middle band between (1 - t) and t is where Jev is unsure,
// and that band is what we surface for a human to look at.

import type { NoulQuestion, Question, ScoreQuestion } from "./client.js";

export interface NoulDef {
  key: string;
  instructions: string;
  criteria: { true: string; false: string };
  threshold: number;
  label: string;
}

export const NOULS: NoulDef[] = [
  {
    key: "conforms_to_spec",
    label: "Conforms to spec",
    instructions:
      "The changed code implements behavior that is consistent with the specification and does not contradict anything the specification states.",
    criteria: {
      true: "The change is fully consistent with the spec; no behavior is contradicted.",
      false: "The change introduces or implies behavior the spec forbids or contradicts.",
    },
    threshold: 0.8,
  },
  {
    key: "spec_still_accurate",
    label: "Spec still accurate",
    instructions:
      "After applying this code change, the specification would remain an accurate description of the system's behavior.",
    criteria: {
      true: "The spec still correctly describes the system after the change.",
      false: "The change makes at least one statement in the spec now incorrect or outdated.",
    },
    threshold: 0.85,
  },
  {
    key: "behavior_is_spec_covered",
    label: "Behavior covered by spec",
    instructions:
      "Every new or changed behavior introduced by this code change is described somewhere in the specification.",
    criteria: {
      true: "All changed behavior is covered by the spec.",
      false: "The change introduces behavior the spec does not describe.",
    },
    threshold: 0.8,
  },
  {
    key: "within_stated_scope",
    label: "Within stated scope",
    instructions:
      "The code change stays within the scope described by the specification and the pull request's stated purpose.",
    criteria: {
      true: "The change is scoped to what the spec and the PR intend.",
      false: "The change adds out-of-scope work beyond the stated purpose.",
    },
    threshold: 0.85,
  },
  {
    key: "intent_matches_diff",
    label: "Intent matches diff",
    instructions:
      "The code change does what the pull request title and description claim it does.",
    criteria: {
      true: "The diff matches the intent stated in the PR.",
      false: "The diff differs from what the PR description claims.",
    },
    threshold: 0.85,
  },
];

export const SCORE_KEY = "drift_level";

export const SCORE_LEVELS = [
  "No drift: the code and the spec remain consistent and the spec is still accurate",
  "Minor drift: a small inconsistency or a small spec gap worth noting",
  "Significant drift: a clear mismatch between the code's behavior and the spec",
  "Contradiction: the code directly violates something the specification states",
];

export const SCORE_HEADLINE_THRESHOLD = 0.6;

// Levels whose headline, at or above the threshold, count as real drift.
export const DRIFT_HEADLINES = new Set([
  "Significant drift",
  "Contradiction",
]);

export const DEFAULT_THRESHOLDS: Record<string, number> = {
  ...Object.fromEntries(NOULS.map((n) => [n.key, n.threshold])),
  [SCORE_KEY]: SCORE_HEADLINE_THRESHOLD,
};

export function buildQuestions(
  overrides?: Record<string, number>,
): { questions: Record<string, Question>; thresholds: Record<string, number> } {
  const questions: Record<string, Question> = {};
  for (const n of NOULS) {
    const q: NoulQuestion = {
      type: "noul",
      instructions: n.instructions,
      criteria: n.criteria,
    };
    questions[n.key] = q;
  }
  const score: ScoreQuestion = {
    type: "score",
    instructions:
      "Rate the overall degree of drift between the specification and the code change after it is applied. Consider both that the code may contradict or extend the spec, and that the spec may now be stale.",
    criteria: SCORE_LEVELS,
  };
  questions[SCORE_KEY] = score;

  const thresholds = { ...DEFAULT_THRESHOLDS };
  if (overrides) {
    for (const k of Object.keys(overrides)) {
      // typeof first: isFinite("0.9") coerces, and a string threshold later
      // reaches toFixed in the report renderer and throws.
      const v = overrides[k];
      if (k in thresholds && typeof v === "number" && Number.isFinite(v) && v > 0.5 && v <= 1) {
        thresholds[k] = v;
      }
    }
  }
  return { questions, thresholds };
}
