import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { consumerRoot, loadConsumer } from "../scripts/lib/consumer.mjs";
import { KyberError } from "../scripts/lib/errors.mjs";
import { CONSUMER } from "./helpers.mjs";

test("consumerRoot walks up from a nested directory to the config", () => {
  assert.equal(consumerRoot(join(CONSUMER, "deep", "er")), CONSUMER);
  assert.equal(consumerRoot(CONSUMER), CONSUMER);
});

test("consumerRoot fails out loud when no ancestor has a config", () => {
  const nowhere = mkdtempSync(join(tmpdir(), "kyber-nowhere-"));
  assert.throws(
    () => consumerRoot(nowhere),
    (error) =>
      error instanceof KyberError &&
      error.message.includes(".kyber/config.json") &&
      error.message.includes(nowhere),
  );
});

test("consumerRoot's default start is kyber itself, which is not a consumer", () => {
  // This repo, cloned on its own, has no .kyber/config.json above it. If this
  // test ever passes because one appeared in a parent directory, that parent
  // is the bug.
  assert.throws(() => consumerRoot(), KyberError);
});

test("loadConsumer returns the config and resolves directories against the root", () => {
  const { root, config, dir } = loadConsumer({
    required: ["name", "projectId", "firebaseDir"],
    from: CONSUMER,
  });
  assert.equal(root, CONSUMER);
  assert.equal(config.projectId, "fixture-project");
  assert.equal(dir("firebaseDir"), join(CONSUMER, "firebase"));
});

test("loadConsumer tolerates keys it was not asked about", () => {
  const { config } = loadConsumer({ required: ["name"], from: CONSUMER });
  assert.deepEqual(config.somethingForALaterBatch, { kept: true });
});

test("loadConsumer names every missing or empty required key", () => {
  const root = mkdtempSync(join(tmpdir(), "kyber-consumer-"));
  mkdirSync(join(root, ".kyber"));
  writeFileSync(
    join(root, ".kyber", "config.json"),
    JSON.stringify({ name: "x", projectId: "   ", firebaseDir: 3 }),
  );
  assert.throws(
    () => loadConsumer({ required: ["name", "projectId", "firebaseDir", "rulesTestsDir"], from: root }),
    (error) =>
      error instanceof KyberError &&
      error.message.includes('"projectId"') &&
      error.message.includes('"firebaseDir"') &&
      error.message.includes('"rulesTestsDir"') &&
      !error.message.includes('"name"'),
  );
});

test("loadConsumer rejects a config that is not a JSON object", () => {
  const root = mkdtempSync(join(tmpdir(), "kyber-consumer-"));
  mkdirSync(join(root, ".kyber"));
  writeFileSync(join(root, ".kyber", "config.json"), "[]");
  assert.throws(() => loadConsumer({ from: root }), /must hold a JSON object/);
  writeFileSync(join(root, ".kyber", "config.json"), "{ not json");
  assert.throws(() => loadConsumer({ from: root }), /not valid JSON/);
});
