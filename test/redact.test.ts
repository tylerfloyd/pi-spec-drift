import { test } from "node:test";
import assert from "node:assert";
import { redact } from "../dist/redact.js";

const cases: Array<{ input: string; contains: string; notContains: string }> = [
  {
    input: "token = ghp_1234567890abcdef1234567890abcdef",
    contains: "[REDACTED:github-token]",
    notContains: "ghp_1234567890abcdef",
  },
  {
    input: "const key = sk_live_abcdef0123456789",
    contains: "[REDACTED:api-key]",
    notContains: "sk_live_abcdef0123456789",
  },
  {
    input: "aws: AKIAIOSFODNN7EXAMPLE",
    contains: "[REDACTED:aws-access-key]",
    notContains: "AKIAIOSFODNN7EXAMPLE",
  },
  {
    input: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIB...\n-----END RSA PRIVATE KEY-----",
    contains: "[REDACTED:private-key]",
    notContains: "MIIEpAIB",
  },
  {
    input: "curl -H 'Authorization: Bearer abcdef0123456789xyz'",
    contains: "Bearer [REDACTED:token]",
    notContains: "abcdef0123456789xyz",
  },
  {
    input: "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.dozjdoiNsj",
    contains: "[REDACTED:jwt]",
    notContains: "eyJhbGciOiJIUzI1NiJ9",
  },
  {
    input: "DATABASE_PASSWORD=Sup3rS3cretValue",
    contains: "DATABASE_PASSWORD=[REDACTED:secret]",
    notContains: "Sup3rS3cretValue",
  },
];

for (const c of cases) {
  test(`redacts ${c.notContains.slice(0, 18)}…`, () => {
    const { text, redactions } = redact(c.input);
    assert.ok(text.includes(c.contains), `expected ${c.contains} in "${text}"`);
    assert.ok(!text.includes(c.notContains), `expected no "${c.notContains}"`);
    assert.ok(redactions.length > 0);
  });
}

test("leaves ordinary text untouched", () => {
  const { text } = redact("const x = 1; console.log('hello world');");
  assert.equal(text, "const x = 1; console.log('hello world');");
});

test("does not redact a short non-secret assignment", () => {
  const { text, redactions } = redact("PORT=8080");
  assert.equal(text, "PORT=8080");
  assert.equal(redactions.length, 0);
});
