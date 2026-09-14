import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveBin } from "../scripts/lib/bin.mjs";
import { KyberError } from "../scripts/lib/errors.mjs";

function fakePackage(root, name, manifest) {
  const dir = join(root, "node_modules", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name, version: "0.0.0", ...manifest }));
  return dir;
}

test("resolveBin follows the package's own bin field, object or string form", () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "kyber-bin-")));
  const nested = join(root, "firebase", "rules-tests");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "package.json"), "{}");
  const tools = fakePackage(root, "fake-tools", { bin: { fake: "./lib/bin/fake.js" } });
  const single = fakePackage(root, "single-bin", { bin: "./cli.mjs" });
  // Resolved from the nested package, found at the workspace root: the
  // arrangement where one consumer keeps the tool in the root manifest.
  assert.equal(resolveBin(nested, "fake-tools", "fake"), join(tools, "lib/bin/fake.js"));
  assert.equal(resolveBin(nested, "single-bin", "whatever"), join(single, "cli.mjs"));
});

test("resolveBin says which package is missing and who should install it", () => {
  const root = mkdtempSync(join(tmpdir(), "kyber-bin-"));
  writeFileSync(join(root, "package.json"), "{}");
  assert.throws(
    () => resolveBin(root, "not-installed-anywhere", "x"),
    (error) => error instanceof KyberError && error.message.includes("peerDependencies"),
  );
  fakePackage(root, "no-bin", {});
  assert.throws(() => resolveBin(root, "no-bin", "x"), /declares no "x"/);
});
