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
