#!/usr/bin/env node
// Habit Hooks transformer: keep only the findings in code this branch changed.
//
// Snoozes are per file, so editing a file brings back every old finding in
// it. This filter keeps a finding only when the branch touched it, compared
// with the merge base of HEAD and [scope] branchBase. Uncommitted and
// untracked work counts as changed.
//
//   oversized-function, high-complexity: the branch wrote the function or
//       made it longer (a ratchet: editing an old long function without
//       growing it does not bring its debt back)
//   too-many-parameters:  the signature line changed, or the function grew
//   duplicated-code:      any changed line in either copy
//   oversized-file:       the branch made the file longer
//   unused-file, unused-dependency: the file was touched at all
//   everything else (unused exports, comments, lint): the reported line changed
//
// Findings with no file (incomplete-run, for example) always pass through.
// Set HABIT_HOOKS_ALL_LINES=1 to turn the filter off, e.g. for a full audit.
// If the base cannot be resolved this exits 1, so the run reports
// incomplete-run instead of a pass it cannot vouch for.
"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");

const FUNCTION_SMELLS = new Set(["oversized-function", "high-complexity", "too-many-parameters"]);
const SIGNATURE_SMELLS = new Set(["too-many-parameters"]);
const GROWTH_SMELLS = new Set(["oversized-file"]);
const FILE_SMELLS = new Set(["unused-file", "unused-dependency"]);
const PASS_SMELLS = new Set(["incomplete-run", "parse-error"]);

function readStdin() {
  return fs.readFileSync(0, "utf8");
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 512 * 1024 * 1024 });
}

function baseRef() {
  if (process.env.HABIT_HOOKS_BASE) return process.env.HABIT_HOOKS_BASE;
  try {
    const toml = fs.readFileSync(path.join(".habit-hooks", "config.toml"), "utf8");
    const match = toml.match(/^\s*branchBase\s*=\s*"([^"]+)"/m);
    if (match) return match[1];
  } catch {
    // No readable config: fall back to the habit-hooks default below.
  }
  return "main";
}

function entryFor(changes, file) {
  if (!changes.has(file)) changes.set(file, { whole: false, lines: new Set(), hunks: [], added: 0, removed: 0 });
  return changes.get(file);
}

function parseHunkHeader(line) {
  const match = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
  if (!match) return null;
  return {
    removed: match[2] === undefined ? 1 : Number(match[2]),
    start: Number(match[3]),
    added: match[4] === undefined ? 1 : Number(match[4]),
  };
}

function recordHunk(entry, hunk) {
  entry.hunks.push(hunk);
  entry.added += hunk.added;
  entry.removed += hunk.removed;
  if (hunk.added === 0) {
    // A pure deletion sits between line `start` and the next one.
    entry.lines.add(hunk.start);
    entry.lines.add(hunk.start + 1);
    return;
  }
  for (let n = hunk.start; n < hunk.start + hunk.added; n += 1) entry.lines.add(n);
}

function changedLines(base, toProjectPath) {
  const mergeBase = git(["merge-base", "HEAD", base]).trim();
  const changes = new Map();
  let current = null;
  for (const line of git(["diff", "-U0", "--no-color", "--no-ext-diff", mergeBase, "--"]).split("\n")) {
    if (line.startsWith("+++ ")) {
      current = line === "+++ /dev/null" ? null : entryFor(changes, toProjectPath(line.slice(6)));
      continue;
    }
    const hunk = current && line.startsWith("@@ ") ? parseHunkHeader(line) : null;
    if (hunk) recordHunk(current, hunk);
  }
  for (const file of git(["ls-files", "--others", "--exclude-standard", "--full-name", "-z"]).split("\0")) {
    if (file) entryFor(changes, toProjectPath(file)).whole = true;
  }
  return changes;
}

function loadTypescript() {
  try {
    const ts = createRequire(path.join(process.cwd(), "package.json"))("typescript");
    return typeof ts.createSourceFile === "function" ? ts : null;
  } catch {
    return null;
  }
}

function functionSpanFinder(ts) {
  const parsed = new Map();
  function sourceOf(file) {
    if (!parsed.has(file)) {
      let source = null;
      try {
        source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
      } catch {
        source = null;
      }
      parsed.set(file, source);
    }
    return parsed.get(file);
  }
  // The smallest function-like node that starts on `line` (1-based) and contains the reported column.
  return function spanOf(file, line, column) {
    const source = ts && sourceOf(file);
    if (!source) return null;
    const lineStarts = source.getLineStarts();
    if (line < 1 || line > lineStarts.length) return null;
    const position = lineStarts[line - 1] + Math.max((column || 1) - 1, 0);
    let best = null;
    function visit(node) {
      if (position < node.getFullStart() || position > node.getEnd()) return;
      const startLine = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      if (ts.isFunctionLike(node) && startLine === line) best = node;
      ts.forEachChild(node, visit);
    }
    visit(source);
    if (!best) return null;
    return [line, source.getLineAndCharacterOfPosition(best.getEnd()).line + 1];
  };
}

function touchesRange(entry, start, end) {
  if (entry.whole) return true;
  for (let n = start; n <= end; n += 1) if (entry.lines.has(n)) return true;
  return false;
}

// Did the hunks that fall inside lines start..end (new-file numbering) add more lines than they removed?
function grewWithin(entry, start, end) {
  if (entry.whole) return true;
  let net = 0;
  for (const hunk of entry.hunks) {
    const inside = hunk.added === 0
      ? hunk.start >= start && hunk.start < end
      : hunk.start <= end && hunk.start + hunk.added - 1 >= start;
    if (inside) net += hunk.added - hunk.removed;
  }
  return net > 0;
}

function keepFunctionIssue(entry, smell, span, start) {
  if (!span) return touchesRange(entry, start, start);
  if (SIGNATURE_SMELLS.has(smell) && touchesRange(entry, start, start)) return true;
  return grewWithin(entry, span[0], span[1]);
}

function makeKeeper(changes, spanOf) {
  const cwd = process.cwd();
  const projectPath = (file) => path.relative(cwd, path.resolve(cwd, file));
  return function keepIssue(smell, issue) {
    const details = issue.details || {};
    const raw = details.file || issue.key;
    if (typeof raw !== "string" || raw.includes("\n")) return true;
    const file = projectPath(raw);
    const entry = changes.get(file);
    if (!entry) return false;
    if (GROWTH_SMELLS.has(smell)) return entry.whole || entry.added > entry.removed;
    if (FILE_SMELLS.has(smell)) return true;
    const start = details.startLine ?? details.line;
    if (start === null || start === undefined) return true;
    if (details.endLine !== undefined && details.endLine !== null) return touchesRange(entry, start, details.endLine);
    if (FUNCTION_SMELLS.has(smell)) return keepFunctionIssue(entry, smell, spanOf(file, start, details.column), start);
    return touchesRange(entry, start, start);
  };
}

function filterFindings(findings, keepIssue) {
  const kept = [];
  for (const finding of findings) {
    const issues = finding.issues || [];
    if (PASS_SMELLS.has(finding.smell)) {
      kept.push(finding);
    } else if (finding.smell === "duplicated-code") {
      if (issues.some((issue) => keepIssue(finding.smell, issue))) kept.push(finding);
    } else {
      const remaining = issues.filter((issue) => keepIssue(finding.smell, issue));
      if (remaining.length > 0) kept.push({ ...finding, issues: remaining });
    }
  }
  return kept;
}

function main() {
  const input = readStdin();
  if (process.env.HABIT_HOOKS_ALL_LINES === "1") {
    process.stdout.write(input);
    return;
  }
  const findings = JSON.parse(input || "[]");
  const top = git(["rev-parse", "--show-toplevel"]).trim();
  const cwd = process.cwd();
  const toProjectPath = (file) => path.relative(cwd, path.resolve(top, file));
  const base = baseRef();
  let changes;
  try {
    changes = changedLines(base, toProjectPath);
  } catch (error) {
    process.stderr.write(`changed-lines: cannot diff against '${base}': ${error.message}\n`);
    process.exit(1);
  }
  const keepIssue = makeKeeper(changes, functionSpanFinder(loadTypescript()));
  process.stdout.write(JSON.stringify(filterFindings(findings, keepIssue)));
}

main();
