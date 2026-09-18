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

  let lastError: Error | undefined;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = retryBaseMs * Math.pow(2, attempt - 1);
      log(`jev: retry ${attempt}/${maxRetries} after ${delay}ms`);
      await sleep(delay);
    }
    try {
      const res = await doFetch(url, body, opts.apiKey, fetchImpl, timeoutMs);
      if (res.ok) {
        const parsed = (await res.json()) as Partial<JevResponse>;
        return validateResponse(parsed, Object.keys(questions));
      }
      if (res.status === 401 || res.status === 403) {
        throw new JevAuthError(`TypeSafe rejected the API key (HTTP ${res.status})`);
      }
      if (RETRYABLE.has(res.status)) {
        const err = new JevRequestError(`TypeSafe HTTP ${res.status}`, res.status, true);
        lastError = err;
        continue;
      }
      const text = await res.text().catch(() => "");
      throw new JevRequestError(
        `TypeSafe HTTP ${res.status}: ${truncate(text, 300)}`,
        res.status,
      );
    } catch (e) {
      if (e instanceof JevAuthError || (e instanceof JevRequestError && !e.retryable)) {
        throw e;
      }
      lastError = e instanceof Error ? e : new Error(String(e));
      // network / fetch errors are retryable
    }
  }
  throw new JevRequestError(
    `TypeSafe request failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
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
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function validateResponse(
  parsed: Partial<JevResponse>,
  expectedKeys: string[],
): JevResponse {
  if (!parsed || typeof parsed !== "object") {
    throw new JevRequestError("TypeSafe returned a non-object response");
  }
  const answers = parsed.answers;
  if (!answers || typeof answers !== "object") {
    throw new JevRequestError("TypeSafe response missing `answers` object");
  }
  const missing = expectedKeys.filter((k) => !(k in answers));
  if (missing.length > 0) {
    throw new JevRequestError(
      `TypeSafe response missing answers for: ${missing.join(", ")}`,
    );
  }
  for (const k of expectedKeys) {
    const a = answers[k];
    if (typeof a !== "object" || a === null) continue;
    if (a.type === "noul" && (typeof a.noul !== "number" || !isFinite(a.noul))) {
      throw new JevRequestError(`TypeSafe returned a non-numeric noul for "${k}"`);
    }
  }
  return {
    model: typeof parsed.model === "string" ? parsed.model : "jev-latest",
    answers: answers as Record<string, Answer>,
    usage: parsed.usage as JevUsage | undefined,
  };
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
