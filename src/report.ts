// Render the verdict as a GitHub PR comment (markdown) and as a machine
// summary (json). The markdown is what humans read; the json drives whether
// the CI check fails.

import { redact } from "./redact.js";
import { truncateHead } from "./state.js";
import type { Evaluation, NoulResult } from "./verdict.js";

export interface ReportMeta {
  blocking?: boolean;
  repository?: string;
  base?: string;
  head?: string;
  prTitle?: string;
  specFiles?: string[];
  changedFiles?: string[];
  generatedAt?: string;
}

const VERDICT_BADGE: Record<string, string> = {
  CLEAN: "✅ **no drift**",
  REVIEW: "⚠️ **needs review**",
  DRIFT: "🔴 **drift detected**",
  NOT_EVALUATED: "⛔ **not evaluated**",
};

const BAND_ICON: Record<string, string> = {
  satisfied: "✅ satisfied",
  violated: "🔴 violated",
  unclear: "⚪ unclear",
};

export function renderMarkdown(ev: Evaluation, meta: ReportMeta): string {
  const badge = VERDICT_BADGE[ev.verdict] ?? ev.verdict;
  const lines: string[] = [];
  lines.push(`## 🔍 Spec Drift Review — ${badge}`);
  lines.push("");

  if (meta.prTitle) {
    lines.push(`> PR: ${safeText(meta.prTitle)}`);
    lines.push("");
  }

  if (ev.verdict === "NOT_EVALUATED") {
    lines.push(
      "Spec drift could not be evaluated. No usable evaluation was obtained, so **nothing is being treated as clean**.",
    );
    lines.push("");
    if (ev.reason) {
      lines.push(`Reason: ${safeText(ev.reason)}`);
      lines.push("");
    }
    lines.push(
      "If this ran in CI, confirm `TYPESAFE_API_KEY` is set as a repository secret. Locally, export `TYPESAFE_API_KEY` in your environment.",
    );
    return footer(lines, ev, meta);
  }

  if (ev.headline) {
    const h = ev.headline;
    lines.push(
      `**Drift level:** ${h.label} — p=${h.levelProbability.toFixed(2)}, confidence ${h.confidence.toFixed(2)}`,
    );
    lines.push("");
  }

  if (ev.noulResults.length > 0) {
    lines.push("| dimension | P(yes) | threshold | result |");
    lines.push("|---|---:|---:|---|");
    for (const n of ev.noulResults) {
      lines.push(
        `| ${n.label} | ${n.p.toFixed(2)} | ${n.threshold.toFixed(2)} | ${BAND_ICON[n.band]} |`,
      );
    }
    lines.push("");
  }

  const flagged = ev.noulResults.filter((n: NoulResult) => n.band === "violated");
  if (ev.verdict === "DRIFT") {
    if (flagged.length > 0) {
      lines.push(
        `**Flagged:** ${flagged
          .map((n: NoulResult) => `\`${n.key}\``)
          .join(", ")} — the change appears to drift from the spec on these dimensions.`,
      );
    } else if (ev.headline) {
      lines.push(
        `**Flagged:** the headline drift level is **${ev.headline.label}**, indicating the code and spec have diverged.`,
      );
    }
    lines.push("");
    lines.push(
      "Suggest either updating the spec to match the new behavior, or revising the change. " + (meta.blocking ? "This check fails on clear drift." : "This check is advisory and is not blocking."),
    );
  } else if (ev.verdict === "REVIEW") {
    const unclear = ev.noulResults.filter((n: NoulResult) => n.band === "unclear");
    const names = unclear.map((n: NoulResult) => `\`${n.key}\``).join(", ");
    lines.push(
      `**Uncertain:** Jev is not decisive on ${names || "the change"}. A quick human look is recommended before merging. ` + (meta.blocking ? "This result does not fail the check; only clear drift or an evaluation failure does." : "This check is advisory and is not blocking."),
    );
  } else {
    lines.push(
      ev.reason ? safeText(ev.reason) : "No drift signals: the change and the spec appear to be consistent with each other.",
    );
  }

  if (ev.headline && ev.headline.distribution) {
    const dist = Object.entries(ev.headline.distribution)
      .map(([k, v]) => `${k} ${(v * 100).toFixed(0)}%`)
      .join(" · ");
    if (dist) {
      lines.push("");
      lines.push(`<details><summary>drift-level distribution</summary>`);
      lines.push("");
      lines.push(dist);
      lines.push("");
      lines.push("</details>");
    }
  }

  return footer(lines, ev, meta);
}

export interface ReportJson {
  verdict: string;
  shouldFail: boolean;
  headline?: {
    label: string;
    probability: number;
    confidence: number;
    expectedLevel: number;
    modalLevel: number;
  };
  questions: Array<{ key: string; kind: string; value: number; band?: string; threshold: number }>;
  usage?: { input_tokens: number; output_tokens: number };
  model?: string;
  reason?: string;
}

export function renderJson(
  ev: Evaluation,
  blockOnDrift: boolean,
  meta: ReportMeta,
): string {
  const shouldFail =
    ev.verdict === "NOT_EVALUATED" ||
    ev.verdict === "DRIFT" && blockOnDrift;
  const doc: ReportJson = {
    verdict: ev.verdict,
    shouldFail,
    questions: ev.questions.map((q) => {
      const item: ReportJson["questions"][number] = {
        key: q.key,
        kind: q.kind,
        // Both kinds report the probability that `threshold` is compared
        // against. The Score's weighted mean lives under headline.expectedLevel
        // — it is a level index, not a probability, and does not belong here.
        value: q.kind === "noul" ? q.p : q.levelProbability,
        threshold: q.threshold,
      };
      if (q.kind === "noul") item.band = q.band;
      return item;
    }),
  };
  if (ev.headline) {
    doc.headline = {
      label: ev.headline.label,
      probability: ev.headline.levelProbability,
      confidence: ev.headline.confidence,
      expectedLevel: ev.headline.expectedLevel,
      modalLevel: ev.headline.modalLevel,
    };
  }
  if (ev.usage) doc.usage = ev.usage;
  if (ev.model) doc.model = truncateHead(redact(ev.model).text, 256);
  if (ev.reason) doc.reason = truncateHead(redact(ev.reason).text, 2000);
  return JSON.stringify(doc, null, 2);
}

function safeText(text: string): string {
  // []() as well as the HTML set: without them an untrusted PR title or repo
  // name can plant a markdown link in the bot's own comment.
  return truncateHead(redact(text).text, 2000).replace(/[\r\n]/g, " ").replace(/[&<>`\[\]()]/g, (c) => `&#${c.charCodeAt(0)};`);
}

function footer(lines: string[], ev: Evaluation, meta: ReportMeta): string {
  const bits: string[] = ["_Generated by **pi-spec-drift**_"];
  if (meta.repository) bits.push(`repo \`${safeText(meta.repository)}\``);
  if (ev.model) bits.push(`model \`${safeText(ev.model)}\``);
  if (ev.usage) {
    bits.push(`${ev.usage.input_tokens} in / ${ev.usage.output_tokens} out tokens`);
  }
  bits.push(new Date(meta.generatedAt ?? Date.now()).toISOString());
  lines.push("");
  lines.push(bits.join(" · "));
  return lines.join("\n");
}
