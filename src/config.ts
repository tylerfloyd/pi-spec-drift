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

  const file = readJson(root);
  if (file) {
    if (Array.isArray(file.specFiles)) cfg.specFiles = file.specFiles;
    if (Array.isArray(file.excludeGlobs)) cfg.excludeGlobs = file.excludeGlobs;
    if (typeof file.model === "string") cfg.model = file.model;
    if (typeof file.blockOnDrift === "boolean") cfg.blockOnDrift = file.blockOnDrift;
    if (typeof file.maxSpecChars === "number") cfg.maxSpecChars = file.maxSpecChars;
    if (typeof file.maxDiffChars === "number") cfg.maxDiffChars = file.maxDiffChars;
    if (file.thresholds) {
      cfg.thresholds = { ...cfg.thresholds, ...file.thresholds };
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
  if (typeof overrides.maxSpecChars === "number") cfg.maxSpecChars = overrides.maxSpecChars;
  if (typeof overrides.maxDiffChars === "number") cfg.maxDiffChars = overrides.maxDiffChars;
  if (overrides.thresholds) cfg.thresholds = { ...cfg.thresholds, ...overrides.thresholds };

  return cfg;
}

function csv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
