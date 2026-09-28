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
