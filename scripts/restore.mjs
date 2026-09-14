#!/usr/bin/env node
// Put a backup back. A backup nobody has ever read back is a hope, and the day
// you find out whether it restores is the worst possible day to find out.
//
// Usage, from the consumer:
//   pnpm restore backups/<file>.json
//     → into the local EMULATOR (the consumer's own port, from firebase.json,
//       unless FIRESTORE_EMULATOR_HOST says otherwise). The default on purpose.
//   pnpm restore --production backups/<file>.json
//     → into the real project. Refuses unless the dump names that project AND
//       was read from production, then asks for a typed confirmation.
//
// Every document in the dump is written over whatever is there; documents that
// exist today but are not in the dump are left alone. This restores, it does
// not wipe.
//
// Reads from .kyber/config.json: name, projectId, emulatorProjectId,
// firebaseDir, and optionally restore.legacyIsoTimestamps.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadFirebaseAdmin } from "./lib/admin.mjs";
import { loadConsumer } from "./lib/consumer.mjs";
import { loadServiceAccount } from "./lib/credentials.mjs";
import { createCodec } from "./lib/dump.mjs";
import { emulatorHost, isLocal } from "./lib/emulator.mjs";
import { KyberError, run } from "./lib/errors.mjs";

function readDump(file) {
  if (!existsSync(file)) throw new KyberError(`No such dump: ${file}`);
  const dump = JSON.parse(readFileSync(file, "utf8"));
  if (dump === null || typeof dump.collections !== "object" || dump.collections === null) {
    throw new KyberError(`${file} is not a backup: no top-level "collections".`);
  }
  return dump;
}

/** Write one document and everything under it, counting per collection path. */
async function restoreDoc(db, revive, collectionPath, doc, counts) {
  await db.collection(collectionPath).doc(doc.id).set(revive(doc.data ?? {}));
  counts[collectionPath] = (counts[collectionPath] ?? 0) + 1;
  for (const [name, docs] of Object.entries(doc.collections ?? {})) {
    for (const child of docs) {
      await restoreDoc(db, revive, `${collectionPath}/${doc.id}/${name}`, child, counts);
    }
  }
}

async function confirmProduction(file, dump, projectId) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log(
    `\nAbout to write ${file} (exported ${dump.exportedAt})\n` +
      `  INTO THE REAL PROJECT: ${projectId}\n\n` +
      "  Every document in the dump is written over whatever is there now.\n" +
      "  Documents that exist today but are NOT in the dump are left alone.\n",
  );
  const answer = await rl.question("  Type the project id to continue: ");
  rl.close();
  if (answer.trim() !== projectId) {
    throw new KyberError("  Did not match. Nothing was written.");
  }
}

async function main() {
  const { config, dir } = loadConsumer({
    required: ["name", "projectId", "emulatorProjectId", "firebaseDir"],
  });
  const args = process.argv.slice(2);
  const production = args.includes("--production");
  const arg = args.find((a) => !a.startsWith("--"));
  if (arg === undefined) {
    throw new KyberError("Usage: pnpm restore [--production] <backup file>");
  }
  const file = resolve(arg);
  const dump = readDump(file);
  const { cert, initializeApp, getFirestore, Timestamp } = await loadFirebaseAdmin();
  const { selectReviver } = createCodec({ Timestamp });
  // Decided before anything is opened: a dump this restore cannot read is
  // refused with nothing written, not halfway through.
  const revive = selectReviver(dump, config);
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;

  if (production) {
    // The dump names the project it came from. Restoring one project's dump
    // into another is never a thing anyone means to do, so it is refused
    // rather than confirmed.
    if (dump.project !== config.projectId) {
      throw new KyberError(
        `This dump is from "${dump.project}", not "${config.projectId}". Refusing.`,
      );
    }
    // And WHERE it was read from, which the check above cannot see: a
    // consumer whose emulator runs under the production project id produces
    // rehearsal dumps that pass it while holding seed data. Restoring one
    // into production would not fail — it would succeed, and overwrite real
    // data with a fixture. A dump with no `source` predates the field and is
    // refused rather than assumed either way.
    if (dump.source !== "production") {
      throw new KyberError(
        dump.source === undefined
          ? 'This dump has no "source" field, so it cannot be told apart from a\n' +
            "  rehearsal. Open it, make sure it is real data, and add\n" +
            '  "source": "production" by hand — or take a fresh backup.'
          : `This dump was read from the ${dump.source}, not production. Refusing.`,
      );
    }
    if (emulator !== undefined && emulator !== "") {
      throw new KyberError(
        "FIRESTORE_EMULATOR_HOST is set and --production was passed. Pick one.",
      );
    }
    const serviceAccount = loadServiceAccount(dir("firebaseDir"), config.projectId);
    await confirmProduction(file, dump, config.projectId);
    initializeApp({ credential: cert(serviceAccount), projectId: config.projectId });
    console.log(`\nrestoring into PRODUCTION (${config.projectId})`);
  } else {
    // The consumer's own emulator port, never Firebase's default: on a machine
    // where something else holds 8080, a restore pointed there would talk to
    // somebody else's database. What makes it safe to write a fixture into a
    // database named after production is that the host is local, so the host
    // is what gets checked, and it is said out loud.
    const host = emulator !== undefined && emulator !== "" ? emulator : emulatorHost(dir("firebaseDir"));
    if (!isLocal(host)) {
      throw new KyberError(`FIRESTORE_EMULATOR_HOST is "${host}", which is not local. Refusing.`);
    }
    process.env.FIRESTORE_EMULATOR_HOST = host;
    const project = process.env.BACKUP_PROJECT_ID ?? config.emulatorProjectId;
    initializeApp({ projectId: project });
    console.log(`restoring into the EMULATOR at ${host} (project "${project}")`);
  }

  const db = getFirestore();
  const counts = {};
  for (const [name, docs] of Object.entries(dump.collections)) {
    for (const doc of docs) await restoreDoc(db, revive, name, doc, counts);
  }
  console.log(`\nrestored from ${file} (exported ${dump.exportedAt}):`);
  for (const [path, n] of Object.entries(counts).sort()) {
    console.log(`  ${n.toString().padStart(5)}  ${path}`);
  }
}

run(main);
