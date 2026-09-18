import { test } from "node:test";
import assert from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { globToRegExp, matchGlobs } from "../dist/glob.js";

test("single-segment * does not cross /", () => {
  const re = globToRegExp("docs/spec*.md");
  assert.ok(re.test("docs/spec-auth.md"));
  assert.ok(!re.test("docs/sub/spec-auth.md"));
  assert.ok(!re.test("spec.md"));
});

test("** matches across segments", () => {
  const re = globToRegExp("**/*.md");
  assert.ok(re.test("a.md"));
  assert.ok(re.test("a/b/c.md"));
  assert.ok(!re.test("a/b/c.txt"));
});

test("literal pattern matches exactly", () => {
  const re = globToRegExp("PRODUCT.md");
  assert.ok(re.test("PRODUCT.md"));
  assert.ok(!re.test("docs/PRODUCT.md"));
});

test("matchGlobs honors includes and excludes over a real tree", () => {
  const root = mkdtempSync(join(tmpdir(), "specdrift-glob-"));
  mkdirSync(join(root, "docs"), { recursive: true });
  mkdirSync(join(root, "docs", "specs"), { recursive: true });
  mkdirSync(join(root, "dist"), { recursive: true });
  writeFileSync(join(root, "PRODUCT.md"), "spec");
  writeFileSync(join(root, "docs", "spec-auth.md"), "spec");
  writeFileSync(join(root, "docs", "specs", "deep.md"), "spec");
  writeFileSync(join(root, "README.md"), "readme");
  writeFileSync(join(root, "dist", "bundle.js"), "code");

  const matches = matchGlobs(root, ["docs/spec*.md"], ["**/dist/**"]);
  // `*` does not cross `/`, so only the file directly in docs/ matches;
  // dist/ is excluded by the exclude glob.
  assert.deepEqual(matches.sort(), ["docs/spec-auth.md"]);
});

test("matchGlobs with ** reaches nested dirs", () => {
  const root = mkdtempSync(join(tmpdir(), "specdrift-glob2-"));
  mkdirSync(join(root, "docs", "specs"), { recursive: true });
  writeFileSync(join(root, "docs", "spec-auth.md"), "spec");
  writeFileSync(join(root, "docs", "specs", "deep.md"), "spec");
  const matches = matchGlobs(root, ["docs/**/*.md"], []);
  assert.deepEqual(matches.sort(), ["docs/spec-auth.md", "docs/specs/deep.md"]);
});
