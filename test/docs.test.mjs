// The docs name files in this repo, and nothing checked that the files were
// still there. Two stale references survived a week each, found by reading
// rather than by any test: consumer-config listed `check-kyber-pins.mjs` in
// its scripts table eight days after the script was removed — while the same
// file explained further down that it could not exist — and the README sent
// readers to "the guard in backup.yml" in the paragraph saying that workflow
// was gone. The markdown-link check in readme.test.mjs could not see either:
// they are code spans, not links.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";

const ROOT = join(import.meta.dirname, "..");

// guardas.md is left out on purpose: it is a record of what happened, and an
// entry naming a file that has since been removed is still true about the day
// it describes.
const DOCS = [
  "README.md",
  ...readdirSync(join(ROOT, "docs"))
    .filter((f) => f.endsWith(".md") && f !== "guardas.md")
    .map((f) => join("docs", f)),
];

const TRACKED = execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const TRACKED_NAMES = new Set(TRACKED.map((f) => basename(f)));

/**
 * The code spans that claim a file in THIS repo, and what each has to match.
 *
 * Narrow on purpose, because these docs are also read inside the consumers
 * and name the consumers' files all the time — `apps/ios/project.yml`,
 * `firebase.json`, `.kyber/config.json` — none of which exist here and none
 * of which are wrong. Three shapes are unambiguous: a path under `kyber/`, a
 * path under a directory only kyber has at its root, and a bare script name,
 * because every `.mjs` and `.py` these docs name is one of kyber's. Anything
 * with a placeholder (`<file>`, `*`) is a pattern, not a file.
 */
function claims(markdown) {
  const out = [];
  for (const [, span] of markdown.matchAll(/`([^`\s]+)`/g)) {
    if (/[<>*]/.test(span)) continue;
    const path = span.replace(/^@?kyber\//, "");
    if (path !== span || /^(scripts|design|test|docs)\//.test(path)) {
      out.push({ span, exists: () => existsSync(join(ROOT, path)) });
    } else if (/^[\w.-]+\.(mjs|py)$/.test(span)) {
      out.push({ span, exists: () => TRACKED_NAMES.has(span) });
    }
  }
  return out;
}

test("every file in this repo that a doc names in a code span exists", () => {
  const all = DOCS.flatMap((doc) =>
    claims(readFileSync(join(ROOT, doc), "utf8")).map((c) => ({ ...c, doc })),
  );
  // Asserted to have found something: a pattern that stops matching returns
  // an empty list, and an empty list passes everything below in silence.
  assert.ok(all.length > 10, `the sweep found only ${all.length} references`);
  const missing = all.filter((c) => !c.exists()).map((c) => `${c.doc}: ${c.span}`);
  assert.deepEqual(missing, []);
});

test("the sweep catches the reference that went stale", () => {
  // The positive control, against the exact text that survived a week.
  const stale = claims("| `check-kyber-pins.mjs` | nothing | ... |\nsee `kyber/scripts/lib/pins.mjs`");
  assert.deepEqual(stale.filter((c) => !c.exists()).map((c) => c.span), [
    "check-kyber-pins.mjs",
    "kyber/scripts/lib/pins.mjs",
  ]);
});

test("consumer-config's scripts table and scripts/ name the same scripts", () => {
  const text = readFileSync(join(ROOT, "docs", "consumer-config.md"), "utf8");
  const table = [...text.matchAll(/^\| `([\w-]+\.mjs)` \|/gm)].map((m) => m[1]).sort();
  const scripts = readdirSync(join(ROOT, "scripts")).filter((f) => f.endsWith(".mjs")).sort();
  assert.ok(table.length > 0, "the table sweep found no rows");
  assert.deepEqual(table, scripts);
});
