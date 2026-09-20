import { test } from "node:test";
import assert from "node:assert";
import { buildQuestions, NOULS, SCORE_KEY } from "../dist/questions.js";

test("five nouls plus one score", () => {
  const { questions } = buildQuestions();
  assert.equal(NOULS.length, 5);
  for (const n of NOULS) {
    const q = questions[n.key];
    assert.equal(q.type, "noul");
    assert.ok(q.instructions.length > 0);
  }
  assert.equal(questions[SCORE_KEY].type, "score");
  assert.equal(Object.keys(questions).length, 6);
});

test("every threshold is in (0.5, 1]", () => {
  const { thresholds } = buildQuestions();
  for (const [k, t] of Object.entries(thresholds)) {
    assert.ok(t > 0.5 && t <= 1, `${k} = ${t}`);
  }
});

test("valid overrides are applied", () => {
  const { thresholds } = buildQuestions({ conforms_to_spec: 0.9 });
  assert.equal(thresholds["conforms_to_spec"], 0.9);
});

test("invalid overrides (out of band or unknown) are ignored", () => {
  const { thresholds } = buildQuestions({
    conforms_to_spec: 0.4, // below the allowed band -> ignored
    bogus_key: 0.99, // unknown key -> ignored
  });
  assert.equal(thresholds["conforms_to_spec"], 0.8); // stays at default
  assert.equal(thresholds["bogus_key"], undefined);
});
