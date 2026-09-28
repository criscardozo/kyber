// kyber states a version in two places, for two readers: stack.json for the
// consumers' own stack-agrees tests, and package.json for npm and for the
// error that sends someone to it when a tool is missing (scripts/lib/bin.mjs).
// Nothing coupled them, and they drifted the first time one moved: stack.json
// went to vitest ^5.0.1 while the peer range stayed at >=4. Only the consumers
// test stack.json, so the copy kyber itself carries had no reader that would
// notice.

import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const ROOT = join(import.meta.dirname, "..");
const stack = JSON.parse(readFileSync(join(ROOT, "stack.json"), "utf8"));
const manifest = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** The major a range or a version starts from: "^5.0.1", ">=5" and "24" all read as one number. */
const major = (spec) => {
  const found = /(\d+)/.exec(spec);
  assert.ok(found, `no version in ${JSON.stringify(spec)}`);
  return Number(found[1]);
};

test("every peer dependency starts at the major stack.json declares", () => {
  const peers = Object.entries(manifest.peerDependencies);
  assert.ok(peers.length > 0);
  for (const [name, range] of peers) {
    assert.ok(stack[name], `${name} is a peer dependency that stack.json does not declare`);
    assert.equal(major(range), major(stack[name].value), `${name}: package.json says ${range}, stack.json ${stack[name].value}`);
  }
});

test("engines.node starts at the node stack.json declares", () => {
  assert.equal(major(manifest.engines.node), major(stack.node.value));
});

// The CI file states the node version a third time, for a third reader.
const ci = readFileSync(join(ROOT, ".github", "workflows", "ci.yml"), "utf8");

test("CI runs the node stack.json declares", () => {
  const versions = [...ci.matchAll(/node-version:\s*"?(\d+)/g)].map((m) => Number(m[1]));
  assert.ok(versions.length > 0, "no node-version in ci.yml");
  for (const v of versions) assert.equal(v, major(stack.node.value));
});

test("every CI job runs on Linux, which is what keeps it free", () => {
  // Public repositories bill nothing for standard runners, and a private one
  // bills macOS at ten times the minutes. The first half is a setting on
  // GitHub that no test here can read; this is the half that lives in the
  // file, and the half a well-meant edit would change.
  const runners = [...ci.matchAll(/runs-on:\s*(\S+)/g)].map((m) => m[1]);
  assert.ok(runners.length > 0, "no runs-on in ci.yml");
  assert.deepEqual(runners.filter((r) => !r.startsWith("ubuntu-")), []);
});
