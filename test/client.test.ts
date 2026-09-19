import { test } from "node:test";
import assert from "node:assert";
import {
  systemOne,
  JevAuthError,
  JevRequestError,
  type Question,
} from "../dist/client.js";

function resp(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const questions: Record<string, Question> = {
  q1: { type: "noul", instructions: "Is it clean?" },
};

const CRITERIA = ["Low: no impact", "High: blocking"];
const scoreQuestions: Record<string, Question> = {
  severity: { type: "score", instructions: "How bad is it?", criteria: CRITERIA },
};

function scoreAnswer(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    type: "score",
    score: 0.7,
    confidence: 0.9,
    legend: { "0": CRITERIA[0], "1": CRITERIA[1] },
    probabilities: { "0": 0.3, "1": 0.7 },
    ...overrides,
  };
}

function onlyScoreAnswer(a: Record<string, unknown>): Record<string, unknown> {
  return { severity: a };
}

test("parses a noul answer and usage", async () => {
  const fetchImpl = (async () =>
    resp({
      model: "jev-latest",
      answers: { q1: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 10, output_tokens: 1 },
    })) as typeof fetch;
  const res = await systemOne("state", questions, { apiKey: "k", fetchImpl });
  assert.equal(res.model, "jev-latest");
  assert.equal((res.answers["q1"] as { noul: number }).noul, 0.9);
  assert.equal(res.usage?.input_tokens, 10);
});

test("sends the Bearer key and json body", async () => {
  let captured: RequestInit | undefined;
  let url = "";
  const fetchImpl = (async (u: any, init: any) => {
    url = u;
    captured = init;
    return resp({ model: "jev-latest", answers: { q1: { type: "noul", noul: 0.5 } } });
  }) as typeof fetch;
  await systemOne("state", questions, { apiKey: "secret-key", fetchImpl, baseUrl: "https://api.typesafe.ai" });
  assert.equal(url, "https://api.typesafe.ai/v1/systemone");
  assert.equal((captured!.headers as any).Authorization, "Bearer secret-key");
  const body = JSON.parse(captured!.body as string);
  assert.equal(body.state, "state");
  assert.equal(body.model, "jev-latest");
  assert.ok(body.questions.q1);
});

test("retries on 429 then succeeds", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return calls === 1 ? resp({ error: "rate limited" }, 429) : resp({ model: "jev-latest", answers: { q1: { type: "noul", noul: 0.5 } } });
  }) as typeof fetch;
  const res = await systemOne("s", questions, { apiKey: "k", fetchImpl, maxRetries: 2, retryBaseMs: 1 });
  assert.equal(calls, 2);
  assert.equal((res.answers["q1"] as { noul: number }).noul, 0.5);
});

test("retries on 529 then surfaces failure", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return resp({ error: "overloaded" }, 529);
  }) as typeof fetch;
  await assert.rejects(
    () => systemOne("s", questions, { apiKey: "k", fetchImpl, maxRetries: 1, retryBaseMs: 1 }),
    JevRequestError,
  );
  assert.equal(calls, 2);
});

test("throws JevAuthError on 401 without retrying", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return resp({ error: "bad key" }, 401);
  }) as typeof fetch;
  await assert.rejects(() => systemOne("s", questions, { apiKey: "bad", fetchImpl, maxRetries: 2, retryBaseMs: 1 }), JevAuthError);
  assert.equal(calls, 1);
});

test("422 (bad request) is not retried", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    return resp({ error: "malformed question" }, 422);
  }) as typeof fetch;
  await assert.rejects(() => systemOne("s", questions, { apiKey: "k", fetchImpl, maxRetries: 2, retryBaseMs: 1 }), JevRequestError);
  assert.equal(calls, 1);
});

test("missing answer for an expected key is an error", async () => {
  const fetchImpl = (async () =>
    resp({ model: "jev-latest", answers: {} })) as typeof fetch;
  await assert.rejects(() => systemOne("s", questions, { apiKey: "k", fetchImpl }), JevRequestError);
});

// --- strict response validation (fail closed on anything that is not
// exactly the shape the TypeSafe API documents) ---

test("accepts a well-formed score answer", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: onlyScoreAnswer(scoreAnswer({})), usage: { input_tokens: 1, output_tokens: 1 } })) as typeof fetch;
  const res = await systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl });
  assert.equal(res.answers["severity"].type, "score");
});

test("rejects a score answer with an empty probability map", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: onlyScoreAnswer(scoreAnswer({ probabilities: {} })) })) as typeof fetch;
  await assert.rejects(() => systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("rejects a score answer missing probabilities or a legend entry", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    const a = scoreAnswer({});
    if (calls === 1) delete a.probabilities;
    else {
      const legend = a.legend as Record<string, string>;
      delete legend["1"];
    }
    return resp({ model: "m", answers: onlyScoreAnswer(a) });
  }) as typeof fetch;
  await assert.rejects(() => systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl }), JevRequestError);
  await assert.rejects(() => systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("rejects a score distribution that sums to zero", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: onlyScoreAnswer(scoreAnswer({ probabilities: { "0": 0, "1": 0 } })) })) as typeof fetch;
  await assert.rejects(() => systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("rejects non-numeric probability values", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: onlyScoreAnswer(scoreAnswer({ probabilities: { "0": "0.3", "1": 0.7 } })) })) as typeof fetch;
  await assert.rejects(() => systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("rejects probability keys that are not level indexes", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: onlyScoreAnswer(scoreAnswer({ probabilities: { "0": 0.3, "wat": 0.7 } })) })) as typeof fetch;
  await assert.rejects(() => systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("rejects probability keys outside the criteria range", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: onlyScoreAnswer(scoreAnswer({ probabilities: { "0": 0.3, "5": 0.7 } })) })) as typeof fetch;
  await assert.rejects(() => systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("rejects a score distribution that does not sum to one", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: onlyScoreAnswer(scoreAnswer({ probabilities: { "0": 0.3, "1": 0.9 } })) })) as typeof fetch;
  await assert.rejects(() => systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("rejects a score value outside the level range", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: onlyScoreAnswer(scoreAnswer({ score: 99 })) })) as typeof fetch;
  await assert.rejects(() => systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("accepts changed legend wording because indexes define levels", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: onlyScoreAnswer(scoreAnswer({ legend: { "0": CRITERIA[0], "1": "Completely different text" } })) })) as typeof fetch;
  const result = await systemOne("s", scoreQuestions, { apiKey: "k", fetchImpl });
  assert.equal(result.answers.severity.type, "score");
});

test("rejects a null answer for an expected question", async () => {
  const fetchImpl = (async () => resp({ model: "m", answers: { q1: null } })) as typeof fetch;
  await assert.rejects(() => systemOne("s", questions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("rejects an answer whose type does not match the question", async () => {
  const fetchImpl = (async () =>
    resp({ model: "m", answers: { q1: { type: "score", score: 0, legend: {}, probabilities: {} } } })) as typeof fetch;
  await assert.rejects(() => systemOne("s", questions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("rejects out-of-range noul values", async () => {
  let calls = 0;
  const fetchImpl = (async () => {
    calls++;
    const noul = calls % 2 === 1 ? 1.5 : -0.2;
    return resp({ model: "m", answers: { q1: { type: "noul", noul } } });
  }) as typeof fetch;
  await assert.rejects(() => systemOne("s", questions, { apiKey: "k", fetchImpl }), JevRequestError);
  await assert.rejects(() => systemOne("s", questions, { apiKey: "k", fetchImpl }), JevRequestError);
});

test("error messages never include the API response body", async () => {
  const fetchImpl = (async () => resp({ error: "echoed secret: SUPERSECRETLEAK" }, 400)) as typeof fetch;
  try {
    await systemOne("s", questions, { apiKey: "k", fetchImpl });
    assert.fail("should have thrown");
  } catch (e) {
    const msg = (e as Error).message;
    assert.ok(!msg.includes("SUPERSECRETLEAK"), `error leaked response body: ${msg}`);
    assert.ok(/400/.test(msg), `status should be present: ${msg}`);
  }
});
