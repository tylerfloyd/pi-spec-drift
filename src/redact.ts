// Redact obvious credentials from text before it is sent off-machine.
//
// The rule is conservative on purpose: redacting a non-secret is harmless,
// shipping a real secret to a third-party API is not. Patterns cover the
// common token/secret shapes seen in code and diffs. Order matters — the
// specific token patterns run first so the generic assignment pattern only
// sees what they did not already catch.

export type SecretKind =
  | "github-token"
  | "aws-access-key"
  | "openai-key"
  | "slack-token"
  | "private-key"
  | "bearer"
  | "jwt"
  | "secret-assignment";

interface Rule {
  kind: SecretKind;
  re: RegExp;
  replace: (match: string, ...groups: string[]) => string;
}

const RULES: Rule[] = [
  {
    kind: "github-token",
    re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g,
    replace: () => "[REDACTED:github-token]",
  },
  {
    kind: "aws-access-key",
    re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
    replace: () => "[REDACTED:aws-access-key]",
  },
  {
    kind: "openai-key",
    re: /\bsk[-_][A-Za-z0-9_-]{16,}\b/g,
    replace: () => "[REDACTED:api-key]",
  },
  {
    kind: "slack-token",
    re: /\bxox[bpasr]-[A-Za-z0-9-]{10,}\b/g,
    replace: () => "[REDACTED:slack-token]",
  },
  {
    kind: "private-key",
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?)-----END [A-Z ]*PRIVATE KEY-----/g,
    replace: () => "[REDACTED:private-key]",
  },
  {
    kind: "bearer",
    re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/g,
    replace: () => "Bearer [REDACTED:token]",
  },
  {
    kind: "jwt",
    re: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g,
    replace: () => "[REDACTED:jwt]",
  },
  {
    // NAME=value / NAME: value where the name looks credential-ish.
    // Keeps the variable name so the diff stays readable; redacts the value.
    kind: "secret-assignment",
    re: /([A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWD|PASSWORD|CREDENTIAL)[A-Za-z0-9_]*)\s*([=:])\s*([A-Za-z0-9][A-Za-z0-9._~+/=-]{7,})/g,
    replace: (_m, name: string, sep: string) => `${name}${sep}[REDACTED:secret]`,
  },
];

export interface RedactionResult {
  text: string;
  redactions: SecretKind[];
}

export function redact(text: string): RedactionResult {
  let out = text;
  const seen: SecretKind[] = [];
  for (const rule of RULES) {
    if (!rule.re.test(out)) continue;
    out = out.replace(rule.re, (...args) => rule.replace(...args));
    // reset lastIndex for the global regex so repeated calls stay correct
    rule.re.lastIndex = 0;
    seen.push(rule.kind);
  }
  return { text: out, redactions: seen };
}
