// Obtain the change under review as a unified diff, either from a file or by
// running git. The diff is then filtered so generated/lock files don't count
// as "changed behavior".

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { globToRegExp } from "./glob.js";

export function diffFromFile(path: string): string {
  return readFileSync(path, "utf8");
}

export function diffFromGit(root: string, base: string, head: string): string {
  // `base...head` = diff from the merge-base of base and head to head.
  let out: string;
  try {
    out = execFileSync(
      "git",
      ["-C", root, "diff", "--no-color", `${base}...${head}`],
      { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (e) {
    const err = e as { stderr?: string; message?: string };
    const errText = String(err.stderr || err.message || "").trim();
    if (/not a git (repository|working directory)/i.test(errText)) {
      throw new Error(`"${root}" is not a git repository`);
    }
    const first = errText.split("\n").slice(0, 3).join(" ").slice(0, 300);
    throw new Error(`git diff ${base}...${head} failed: ${first || "unknown error"}`);
  }
  return out;
}

export interface DiffBundle {
  diff: string;
  changedFiles: string[];
  droppedFiles: string[];
}

// Split a unified diff into per-file sections, drop excluded ones, and
// reassemble. Returns the filtered diff plus the changed-file list.
export function filterDiff(diff: string, excludes: string[]): DiffBundle {
  const rx = excludes.map(globToRegExp);
  const sections = diff.split(new RegExp("^diff --git ", "m"));
  const kept: string[] = [];
  const changed: string[] = [];
  const dropped: string[] = [];

  for (let i = 1; i < sections.length; i++) {
    const headerLine = sections[i].split("\n", 1)[0] ?? "";
    // header looks like `a/src/x.ts b/src/x.ts` or `b/src/x.ts`
    const m = headerLine.match(/ b(\/\S*)$/);
    const path = m ? m[1].replace(/^\//, "") : headerLine;
    if (path && rx.some((r) => r.test(path))) {
      dropped.push(path);
      continue;
    }
    changed.push(path);
    kept.push("diff --git " + sections[i]);
  }

  return { diff: kept.join(""), changedFiles: changed, droppedFiles: dropped };
}
