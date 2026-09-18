// A tiny glob matcher + filesystem walker, dependency-free.
//
// Supports the subset of glob patterns that spec-file configuration needs:
//   - `*`   matches within a path segment (no `/`)
//   - `**`  matches any number of path segments
//   - `?`   matches a single character within a segment
//   - `[...]` character classes
// Anything else is matched literally. Paths are compared as forward-slash
// relative paths from the root.

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function globToRegExp(pattern: string): RegExp {
  const s = pattern.replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "*") {
      if (s[i + 1] === "*") {
        if (s[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2; // consume the `**` and the following `/`
        } else {
          re += ".*";
          i += 1; // consume both stars (loop advances past the second)
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else if (c === "[") {
      let j = i + 1;
      let cls = "";
      let neg = false;
      if (s[j] === "!" || s[j] === "^") {
        neg = true;
        j++;
      }
      while (j < s.length && s[j] !== "]") {
        cls += s[j];
        j++;
      }
      if (j >= s.length) {
        re += "\\["; // no closing bracket — treat as literal
      } else {
        if (cls.length === 0) re += neg ? "[^\\]]" : "\\]";
        else re += `[${neg ? "^" : ""}${cls}]`;
        i = j;
      }
    } else {
      re += c.replace(/[.+^${}()|+\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

function walk(root: string, dir: string, out: string[]): void {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "_specdrift") continue;
    const full = join(dir, entry.name);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) {
      walk(root, full, out);
    } else if (stat.isFile()) {
      const rel = full.startsWith(root)
        ? full.slice(root.length).replace(/^[\\/]/, "")
        : full;
      out.push(rel.split("\\").join("/"));
    }
  }
}

export function listFiles(root: string): string[] {
  const out: string[] = [];
  walk(root, root, out);
  return out;
}

export function matchGlobs(
  root: string,
  patterns: string[],
  excludes: string[],
): string[] {
  const files = listFiles(root);
  const include = patterns.map(globToRegExp);
  const exclude = excludes.map(globToRegExp);
  return files.filter(
    (f) =>
      include.some((r) => r.test(f)) && !exclude.some((r) => r.test(f)),
  );
}
