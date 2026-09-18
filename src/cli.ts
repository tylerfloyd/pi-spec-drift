#!/usr/bin/env node
// pi-spec-drift CLI.
//
// Reads a change (a git range or a diff file) and your spec files, sends a
// bounded + redacted state to Jev, and prints a drift verdict. In CI the same
// CLI writes a markdown report (for the PR comment) and a json summary (to
// decide whether the check fails).
//
// Exit codes:
//   0  pass (CLEAN / REVIEW, or DRIFT when not blocking)
//   1  should fail the check (DRIFT while blocking, or NOT_EVALUATED)
//   2  usage / configuration error

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { systemOne, JevAuthError, JevRequestError } from "./client.js";
import { buildState, type SpecFile } from "./state.js";
import { buildQuestions, NOULS, SCORE_KEY } from "./questions.js";
import { evaluate, type Evaluation } from "./verdict.js";
import { renderMarkdown, renderJson, type ReportMeta } from "./report.js";
import { loadConfig } from "./config.js";
import { matchGlobs } from "./glob.js";
import { diffFromGit, diffFromFile, filterDiff, type DiffBundle } from "./diff.js";

interface CliOptions {
  command: string;
  root?: string;
  diffFile?: string;
  base?: string;
  head?: string;
  specGlob?: string;
  prTitle?: string;
  prDesc?: string;
  repo?: string;
  model?: string;
  block?: boolean;
  json?: boolean;
  dryRun?: boolean;
  stateOut?: string;
  reportMd?: string;
  reportJson?: string;
}

const VERSION = "0.1.0";

const BOOLEANS = new Set(["block", "json", "dry-run"]);

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { command: "review" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      if (i === 0) opts.command = a;
      continue;
    }
    const eq = a.indexOf("=");
    let name = a;
    let val: string | undefined;
    if (eq >= 0) {
      name = a.slice(0, eq);
      val = a.slice(eq + 1);
    } else if (!BOOLEANS.has(name.slice(2))) {
      val = argv[++i];
    }
    const key = name.slice(2).replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
    assign(opts, key, val);
  }
  return opts;
}

function assign(opts: CliOptions, key: string, val: string | undefined): void {
  switch (key) {
    case "command":
      if (val) opts.command = val;
      break;
    case "root":
      opts.root = val;
      break;
    case "diffFile":
      opts.diffFile = val;
      break;
    case "base":
      opts.base = val;
      break;
    case "head":
      opts.head = val;
      break;
    case "specGlob":
      opts.specGlob = val;
      break;
    case "prTitle":
      opts.prTitle = val;
      break;
    case "prDesc":
      opts.prDesc = val;
      break;
    case "repo":
      opts.repo = val;
      break;
    case "model":
      opts.model = val;
      break;
    case "stateOut":
      opts.stateOut = val;
      break;
    case "reportMd":
      opts.reportMd = val;
      break;
    case "reportJson":
      opts.reportJson = val;
      break;
    case "block":
    case "json":
    case "dryRun":
      opts[key as "block" | "json" | "dryRun"] = val === undefined ? true : val === "true";
      break;
    default:
      process.stderr.write(`specdrift: unknown option --${key}\n`);
      process.exit(2);
  }
}

function csv(s?: string): string[] | undefined {
  if (!s) return undefined;
  return s.split(",").map((x) => x.trim()).filter(Boolean);
}

function write(path: string | undefined, content: string): void {
  if (!path) return;
  const abs = resolve(process.cwd(), path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, "utf8");
}

function notEvaluated(reason: string, model?: string): Evaluation {
  return { verdict: "NOT_EVALUATED", evaluated: false, questions: [], noulResults: [], model, reason };
}

function noChanges(): Evaluation {
  return {
    verdict: "CLEAN",
    evaluated: true,
    questions: [],
    noulResults: [],
    reason: "no changes in the diff; nothing to compare against the spec",
  };
}

async function main(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);

  if (opts.command === "version" || opts.command === "--version") {
    console.log(VERSION);
    return;
  }
  if (opts.command === "help" || opts.command === "--help") {
    console.log(HELP);
    return;
  }
  if (opts.command !== "review") {
    process.stderr.write(`specdrift: unknown command "${opts.command}"\n\n${HELP}\n`);
    process.exit(2);
  }

  const root = opts.root ? resolve(process.cwd(), opts.root) : process.cwd();

  const overrides = {
    specFiles: csv(opts.specGlob),
    model: opts.model,
    blockOnDrift: opts.block ? true : undefined,
  };
  const cfg = loadConfig(root, overrides);

  // --- gather the change ---
  let rawDiff = "";
  let diffError: string | undefined;

  if (opts.diffFile) {
    const p = resolve(root, opts.diffFile);
    if (!existsSync(p)) {
      process.stderr.write(`specdrift: diff file not found: ${p}\n`);
      process.exit(2);
    }
    rawDiff = diffFromFile(p);
  } else if (opts.base && opts.head) {
    try {
      rawDiff = diffFromGit(root, opts.base, opts.head);
    } catch (e) {
      diffError = (e as Error).message;
    }
  } else if (opts.base || opts.head) {
    process.stderr.write("specdrift: --base and --head must be given together (or use --diff-file)\n");
    process.exit(2);
  }

  const labels: Record<string, string> = {
    ...Object.fromEntries(NOULS.map((n) => [n.key, n.label])),
    [SCORE_KEY]: "Drift level",
  };

  let ev: Evaluation;
  let filtered: DiffBundle = { diff: "", changedFiles: [], droppedFiles: [] };
  let
    specFiles: SpecFile[] = [];

  if (diffError) {
    ev = notEvaluated(`could not compute the change: ${diffError}`, cfg.model);
  } else {
    filtered = filterDiff(rawDiff, cfg.excludeGlobs);
    const specPaths = matchGlobs(root, cfg.specFiles, cfg.excludeGlobs);
    specFiles = specPaths
      .map((p) => ({ path: p, content: tryRead(resolve(root, p)) }))
      .filter((f) => f.content !== null)
      .map((f) => ({ path: f.path, content: f.content as string }));

    const state = buildState({
      repository: opts.repo,
      branch: { base: opts.base, head: opts.head },
      pr: { title: opts.prTitle, description: opts.prDesc },
      specFiles,
      diff: filtered.diff,
      changedFiles: filtered.changedFiles,
      maxSpecChars: cfg.maxSpecChars,
      maxDiffChars: cfg.maxDiffChars,
    });
    const { questions, thresholds } = buildQuestions(cfg.thresholds);

    if (opts.dryRun) {
      const out = {
        state,
        questions,
        thresholds,
        model: cfg.model,
        specFiles: specFiles.map((f) => f.path),
        changedFiles: filtered.changedFiles,
        droppedFiles: filtered.droppedFiles,
      };
      const text = JSON.stringify(out, null, 2);
      write(opts.stateOut, text);
      if (!opts.stateOut) console.log(text);
      process.stdout.write(`specdrift: dry-run — would send state (${JSON.stringify(state).length} chars), no API call\n`);
      return;
    }

    if (filtered.diff.trim().length === 0) {
      ev = noChanges();
    } else if (specFiles.length === 0) {
      ev = notEvaluated(
        `no spec files matched the configured glob (${cfg.specFiles.join(", ")}). Set specFiles in .spec-drift.json or pass --spec-glob.`,
        cfg.model,
      );
    } else {
      const apiKey = process.env.TYPESAFE_API_KEY;
      if (!apiKey) {
        ev = notEvaluated(
          "no TYPESAFE_API_KEY is set. Export it locally or configure it as a repository secret in CI. No result is being treated as clean.",
          cfg.model,
        );
      } else {
        try {
          const baseUrl = process.env.SPEC_DRIFT_BASE_URL;
          const res = await systemOne(state, questions, {
            apiKey,
            model: cfg.model,
            ...(baseUrl ? { baseUrl } : {}),
          });
          ev = evaluate({
            answers: res.answers,
            thresholds,
            labels,
            evaluated: true,
            usage: res.usage,
            model: res.model,
          });
        } catch (e) {
          const msg =
            e instanceof JevAuthError
              ? `TypeSafe rejected the API key: ${(e as Error).message}`
              : e instanceof JevRequestError
                ? `TypeSafe request failed: ${(e as Error).message}`
                : `unexpected error: ${(e as Error).message}`;
          ev = notEvaluated(msg, cfg.model);
        }
      }
    }
  }

  const meta: ReportMeta = {
    repository: opts.repo,
    base: opts.base,
    head: opts.head,
    prTitle: opts.prTitle,
    specFiles: specFiles.map((f) => f.path),
    changedFiles: filtered.changedFiles,
  };

  const md = renderMarkdown(ev, meta);
  const json = renderJson(ev, cfg.blockOnDrift, meta);

  const shouldFail =
    ev.verdict === "NOT_EVALUATED" || (ev.verdict === "DRIFT" && cfg.blockOnDrift);

  write(opts.reportMd, md);
  write(opts.reportJson, json);

  if (opts.reportMd) {
    process.stderr.write(`specdrift: report written to ${opts.reportMd}\n`);
  }
  if (opts.json || !opts.reportMd) {
    process.stdout.write(opts.json ? json + "\n" : md + "\n");
  }
  process.stderr.write(
    `specdrift: verdict=${ev.verdict} block=${cfg.blockOnDrift} shouldFail=${shouldFail}\n`,
  );

  process.exit(shouldFail ? 1 : 0);
}

function tryRead(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

const HELP = `pi-spec-drift ${VERSION}

Usage:
  specdrift review [options]

Options:
  --root <dir>        repository root (default: current directory)
  --diff-file <path>  read the change from a unified-diff file
  --base <ref>        git base ref (use with --head)
  --head <ref>        git head ref (use with --base)
  --spec-glob <csv>   comma-separated spec-file globs (overrides config)
  --pr-title <text>   pull request title (context for Jev)
  --pr-desc <text>    pull request description (context for Jev)
  --repo <owner/name> repository label for the report
  --model <alias>     TypeSafe model alias (default: jev-latest)
  --block             fail the run on clear drift (default: advisory)
  --dry-run           print the state + questions that would be sent, no API call
  --state-out <file>  write the dry-run payload to a file
  --report-md <file>  write the markdown PR comment to a file
  --report-json <file> write the machine summary to a file
  --json              print the machine summary instead of markdown
  --version, --help

Environment:
  TYPESAFE_API_KEY    required to actually evaluate (fails closed when absent)
  SPEC_DRIFT_BASE_URL override the API base URL (default: https://api.typesafe.ai)
  SPEC_DRIFT_BLOCK    "1" to enable blocking
  SPEC_DRIFT_SPEC_GLOB comma-separated spec-file globs
  SPEC_DRIFT_MODEL    model alias (default: jev-latest)

Config file (.spec-drift.json in the repo root):
  { "specFiles": ["PRODUCT.md","docs/spec*.md"], "blockOnDrift": false,
    "thresholds": { "conforms_to_spec": 0.8 }, "model": "jev-latest" }
`;

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`specdrift: fatal: ${(e as Error).message}\n`);
  process.exit(2);
});
