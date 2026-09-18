// Library entry point for pi-spec-drift.

export {
  systemOne,
  JevAuthError,
  JevRequestError,
  type NoulQuestion,
  type ScoreQuestion,
  type Question,
  type NoulAnswer,
  type ScoreAnswer,
  type Answer,
  type JevResponse,
  type JevClientOptions,
} from "./client.js";

export {
  buildState,
  truncateHead,
  type DriftState,
  type SpecFile,
  type StateOptions,
} from "./state.js";

export {
  NOULS,
  SCORE_KEY,
  SCORE_LEVELS,
  DEFAULT_THRESHOLDS,
  buildQuestions,
  type NoulDef,
} from "./questions.js";

export {
  evaluate,
  band,
  type Evaluation,
  type NoulResult,
  type HeadlineResult,
  type Band,
  type Verdict,
  type EvaluateInput,
} from "./verdict.js";

export {
  renderMarkdown,
  renderJson,
  type ReportMeta,
  type ReportJson,
} from "./report.js";

export {
  loadConfig,
  DEFAULT_CONFIG,
  type Config,
  type ConfigOverrides,
} from "./config.js";

export { redact, type SecretKind, type RedactionResult } from "./redact.js";
export { matchGlobs, listFiles, globToRegExp } from "./glob.js";
export {
  diffFromGit,
  diffFromFile,
  filterDiff,
  type DiffBundle,
} from "./diff.js";
