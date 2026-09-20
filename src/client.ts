// A minimal client for the TypeSafe "System One" API (Jev).
//
// POST https://api.typesafe.ai/v1/systemone
//   Authorization: Bearer <key>
//   body: { state, model, questions }
// resp: { model, answers: { [id]: Answer }, usage }
//
// We write our own transport (built-in fetch) rather than wrapping a vendor
// SDK, so the failure surface is exactly what we understand. 429/529 are
// retried with backoff; anything that cannot be resolved into a numeric
// answer for a question is surfaced so the caller can fail closed.

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true: string; false: string };
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  criteria: string[];
}

export type Question = NoulQuestion | ScoreQuestion;

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  legend: Record<string, string>;
  probabilities: Record<string, number>;
  confidence: number;
}

export type Answer = NoulAnswer | ScoreAnswer;

export interface JevUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface JevResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: JevUsage;
}

export interface JevClientOptions {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  timeoutMs?: number;
  maxRetries?: number;
  retryBaseMs?: number;
  fetchImpl?: typeof fetch;
  logger?: (msg: string) => void;
}

export class JevAuthError extends Error {}
export class JevRequestError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly retryable = false,
  ) {
    super(message);
  }
}

const RETRYABLE = new Set([429, 500, 502, 503, 504, 529]);

interface RawRequest {
  state: unknown;
  model: string;
  questions: Record<string, Question>;
}

export async function systemOne(
  state: unknown,
  questions: Record<string, Question>,
  opts: JevClientOptions,
): Promise<JevResponse> {
  const baseUrl = (opts.baseUrl ?? "https://api.typesafe.ai").replace(/\/$/, "");
  const url = `${baseUrl}/v1/systemone`;
  const model = opts.model ?? "jev-latest";
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxRetries = opts.maxRetries ?? 2;
  const retryBaseMs = opts.retryBaseMs ?? 500;
  const timeoutMs = opts.timeoutMs ?? 15000;
  const log = opts.logger ?? (() => {});

  const body: RawRequest = { state, model, questions };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = retryBaseMs * Math.pow(2, attempt - 1);
      log(`jev: retry ${attempt}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
    try {
      const res = await doFetch(url, body, opts.apiKey, fetchImpl, timeoutMs);
      if (res.ok) {
        return validateResponse(res.payload, questions);
      }
      if (res.status === 401 || res.status === 403) {
        throw new JevAuthError(`TypeSafe rejected the API key (HTTP ${res.status})`);
      }
      if (RETRYABLE.has(res.status)) {
        continue;
      }
      throw new JevRequestError(`TypeSafe HTTP ${res.status}`, res.status);
    } catch (e) {
      if (e instanceof JevAuthError || (e instanceof JevRequestError && !e.retryable)) {
        throw e;
      }
      // Network / fetch errors are retryable; never echo their raw messages.
    }
  }
  throw new JevRequestError(
    `TypeSafe request failed after ${maxRetries + 1} attempts (network, timeout, or transient HTTP failure)`,
    undefined,
    false,
  );
}

async function doFetch(
  url: string,
  body: unknown,
  apiKey: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<{ ok: boolean; status: number; payload?: unknown }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
      redirect: "error",
    });
    // Keep the timeout active until the response body has been consumed.
    let payload: unknown;
    if (response.ok) {
      try { payload = await response.json(); }
      catch { throw new JevRequestError("TypeSafe returned an unreadable JSON response"); }
    } else {
      await response.body?.cancel();
    }
    return { ok: response.ok, status: response.status, payload };
  } finally {
    clearTimeout(timer);
  }
}

function validateResponse(
  value: unknown,
  questions: Record<string, Question>,
): JevResponse {
  const parsed = value as Partial<JevResponse>;
  if (!parsed || typeof parsed !== "object") {
    throw new JevRequestError("TypeSafe returned a non-object response");
  }
  const answers = parsed.answers;
  if (!answers || typeof answers !== "object") {
    throw new JevRequestError("TypeSafe response missing `answers` object");
  }
  const expectedKeys = Object.keys(questions);
  const missing = expectedKeys.filter((k) => !Object.hasOwn(answers, k));
  if (missing.length > 0) {
    throw new JevRequestError(
      `TypeSafe response missing answers for: ${missing.join(", ")}`,
    );
  }
  validateAnswers(answers, questions);
  let usage: JevUsage | undefined;
  if (parsed.usage !== undefined) {
    const u = parsed.usage;
    if (!isRecord(u) || !Number.isSafeInteger(u.input_tokens) || !Number.isSafeInteger(u.output_tokens) || u.input_tokens < 0 || u.output_tokens < 0) {
      throw new JevRequestError("TypeSafe returned invalid usage metadata");
    }
    usage = { input_tokens: u.input_tokens, output_tokens: u.output_tokens };
  }
  return {
    model: typeof parsed.model === "string" ? parsed.model : "jev-latest",
    answers: answers as Record<string, Answer>,
    usage,
  };
}

// Shared with the public evaluator: bypassing the HTTP client must not turn
// malformed answers into CLEAN. Score indexes are zero-based per
// https://docs.typesafe.ai/primitives/score (Levels / Response structure).
export function validateAnswers(value: unknown, questions: Record<string, Question>): asserts value is Record<string, Answer> {
  if (!isRecord(value)) throw new JevRequestError("TypeSafe response missing answers object");
  for (const [key, q] of Object.entries(questions)) {
    const a = value[key];
    if (!Object.hasOwn(value, key) || !isRecord(a) || a.type !== q.type) {
      throw new JevRequestError(`TypeSafe returned a missing or wrong-type answer for "${key}"`);
    }
    if (q.type === "noul") {
      if (!probability(a.noul)) throw new JevRequestError(`TypeSafe returned an invalid noul for "${key}"`);
      continue;
    }
    const n = q.criteria.length;
    if (typeof a.score !== "number" || !Number.isFinite(a.score) || a.score < 0 || a.score > n - 1 || !probability(a.confidence)) {
      throw new JevRequestError(`TypeSafe returned an invalid score or confidence for "${key}"`);
    }
    const probs = a.probabilities;
    const legend = a.legend;
    if (!isRecord(probs) || !isRecord(legend) || Object.keys(probs).length !== n || Object.keys(legend).length !== n) {
      throw new JevRequestError(`TypeSafe returned an incomplete score distribution for "${key}"`);
    }
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const p = probs[String(i)];
      if (!Object.hasOwn(probs, String(i)) || !probability(p) || typeof legend[String(i)] !== "string") {
        throw new JevRequestError(`TypeSafe returned an invalid score level for "${key}"`);
      }
      sum += p;
    }
    if (Math.abs(sum - 1) > 1e-6) throw new JevRequestError(`TypeSafe probabilities do not sum to one for "${key}"`);
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return !!x && typeof x === "object" && !Array.isArray(x);
}
function probability(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
