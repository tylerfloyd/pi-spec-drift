// Configuration: what counts as "the spec", budgets, thresholds, and whether
// drift blocks the check.
//
// Precedence (later wins): defaults < .spec-drift.json < env < CLI flags.

import { existsSync, readFileSync } from "node:fs";
import { DEFAULT_THRESHOLDS } from "./questions.js";

export interface Config {
  specFiles: string[];
  excludeGlobs: string[];
  model: string;
  blockOnDrift: boolean;
  maxSpecChars: number;
  maxDiffChars: number;
  thresholds: Record<string, number>;
}

export const DEFAULT_CONFIG: Config = {
  specFiles: ["PRODUCT.md", "TECH.md", "SPEC.md", "docs/spec*.md"],
  excludeGlobs: [
    "**/node_modules/**",
    "**/dist/**",
    "**/*lock",
    "**/*.min.js",
    "**/package-lock.json",
  ],
  model: "jev-latest",
  blockOnDrift: false,
  maxSpecChars: 16000,
  maxDiffChars: 24000,
  thresholds: { ...DEFAULT_THRESHOLDS },
};

export interface ConfigOverrides {
  specFiles?: string[];
  blockOnDrift?: boolean;
  model?: string;
  maxSpecChars?: number;
  maxDiffChars?: number;
  thresholds?: Record<string, number>;
}

function readJson(root: string): Partial<Config> | null {
  const path = `${root}/.spec-drift.json`;
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Partial<Config>;
  } catch (e) {
    throw new Error(`could not parse ${path}: ${(e as Error).message}`);
  }
}

export function loadConfig(
  root: string,
  overrides: ConfigOverrides = {},
): Config {
  let cfg: Config = {
    ...DEFAULT_CONFIG,
    thresholds: { ...DEFAULT_CONFIG.thresholds },
    specFiles: [...DEFAULT_CONFIG.specFiles],
    excludeGlobs: [...DEFAULT_CONFIG.excludeGlobs],
  };

  const path = `${root}/.spec-drift.json`;
  const file = readJson(root);
  if (file) {
    if (Array.isArray(file.specFiles)) cfg.specFiles = file.specFiles;
    if (Array.isArray(file.excludeGlobs)) cfg.excludeGlobs = file.excludeGlobs;
    if (typeof file.model === "string") cfg.model = file.model;
    if (typeof file.blockOnDrift === "boolean") cfg.blockOnDrift = file.blockOnDrift;
    if (file.maxSpecChars !== undefined) {
      cfg.maxSpecChars = budget("maxSpecChars", file.maxSpecChars, path);
    }
    if (file.maxDiffChars !== undefined) {
      cfg.maxDiffChars = budget("maxDiffChars", file.maxDiffChars, path);
    }
    if (file.thresholds) {
      cfg.thresholds = { ...cfg.thresholds, ...checkThresholds(file.thresholds, path) };
    }
  }

  // Environment overrides
  if (process.env.SPEC_DRIFT_BLOCK === "1" || process.env.SPEC_DRIFT_BLOCK === "true") {
    cfg.blockOnDrift = true;
  }
  if (process.env.SPEC_DRIFT_SPEC_GLOB) {
    cfg.specFiles = csv(process.env.SPEC_DRIFT_SPEC_GLOB);
  }
  if (process.env.SPEC_DRIFT_MODEL) cfg.model = process.env.SPEC_DRIFT_MODEL;

  // CLI overrides (highest precedence)
  if (overrides.specFiles) cfg.specFiles = overrides.specFiles;
  if (typeof overrides.blockOnDrift === "boolean") cfg.blockOnDrift = overrides.blockOnDrift;
  if (overrides.model) cfg.model = overrides.model;
  if (overrides.maxSpecChars !== undefined) {
    cfg.maxSpecChars = budget("maxSpecChars", overrides.maxSpecChars, "command line");
  }
  if (overrides.maxDiffChars !== undefined) {
    cfg.maxDiffChars = budget("maxDiffChars", overrides.maxDiffChars, "command line");
  }
  if (overrides.thresholds) {
    cfg.thresholds = { ...cfg.thresholds, ...checkThresholds(overrides.thresholds, "command line") };
  }

  return cfg;
}

function csv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

// Character budgets reach truncateHead, which requires a non-negative safe
// integer. Validating here turns a bad value into a reported configuration
// error instead of an opaque throw part-way through building the state.
function budget(field: string, value: unknown, source: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(
      `${source}: ${field} must be a non-negative whole number, got ${JSON.stringify(value)}`,
    );
  }
  return value;
}

// Thresholds are rendered with toFixed and compared against probabilities, so
// a string that merely coerces is not good enough. An out-of-range value is
// reported rather than dropped, so a typo cannot quietly leave the default in
// place while the author believes the threshold was applied.
function checkThresholds(
  thresholds: Record<string, unknown>,
  source: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(thresholds)) {
    if (!(key in DEFAULT_THRESHOLDS)) {
      throw new Error(
        `${source}: unknown threshold "${key}" (known: ${Object.keys(DEFAULT_THRESHOLDS).join(", ")})`,
      );
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0.5 || value > 1) {
      throw new Error(
        `${source}: threshold "${key}" must be a number in (0.5, 1], got ${JSON.stringify(value)}`,
      );
    }
    out[key] = value;
  }
  return out;
}
