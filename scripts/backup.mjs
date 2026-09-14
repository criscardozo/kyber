#!/usr/bin/env node
// Local Firestore backup: dumps the whole project (every root collection, with
// subcollections) to a timestamped JSON file. Firestore has no free managed
// export (that needs Blaze), so this is the $0 path: read everything with the
// Admin SDK and write it to disk.
//
// Usage, from the consumer:
//   GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json pnpm backup
//     (or drop the key at <firebaseDir>/service-account.json, gitignored)
//   FIRESTORE_EMULATOR_HOST=127.0.0.1:<port> pnpm backup
//     reads the emulator instead, for rehearsing the round trip
//
// Output: <consumer>/backups/<name>-<source>-<stamp>.json (gitignored). The
// name carries where the data came from because a rehearsal against the
// emulator and a real backup are otherwise the same object, and the day you
// need one is the day you cannot check.
//
// Reads from .kyber/config.json: name, projectId, emulatorProjectId, firebaseDir.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadFirebaseAdmin } from "./lib/admin.mjs";
import { loadConsumer } from "./lib/consumer.mjs";
import { loadServiceAccount } from "./lib/credentials.mjs";
import { DUMP_FORMAT, createCodec, dumpFileName } from "./lib/dump.mjs";
import { run } from "./lib/errors.mjs";

// Recursively serialise a document's data plus every subcollection.
async function dumpDoc(serialize, docRef) {
  const snap = await docRef.get();
  const out = { id: docRef.id, data: serialize(snap.data() ?? {}, docRef.path) };
  const subcollections = await docRef.listCollections();
  if (subcollections.length > 0) {
    out.collections = {};
    for (const sub of subcollections) {
      out.collections[sub.id] = await dumpCollection(serialize, sub);
    }
  }
  return out;
}

async function dumpCollection(serialize, collRef) {
  const snap = await collRef.get();
  const docs = [];
  for (const doc of snap.docs) docs.push(await dumpDoc(serialize, doc.ref));
  return docs;
}

async function main() {
  const { root, config, dir } = loadConsumer({
    required: ["name", "projectId", "emulatorProjectId", "firebaseDir"],
  });
  const { cert, initializeApp, getFirestore, Timestamp } = await loadFirebaseAdmin();
  const { serialize } = createCodec({ Timestamp });

  // `source` and `project` describe the connection that was actually opened,
  // never an argument. `BACKUP_PROJECT_ID` once overrode the label but not the
  // connection, so running with production credentials and that variable set
  // read the real data and stamped it as something else — a good backup that
  // restore refuses, because it checks the label. The label cannot come from
  // the same variable you might have got wrong.
  const emulator = process.env.FIRESTORE_EMULATOR_HOST;
  let source;
  let project;
  if (emulator !== undefined && emulator !== "") {
    source = "emulator";
    project = process.env.BACKUP_PROJECT_ID ?? config.emulatorProjectId;
    console.log(`reading the EMULATOR at ${emulator} (project "${project}")`);
    initializeApp({ projectId: project });
  } else {
    const serviceAccount = loadServiceAccount(dir("firebaseDir"), config.projectId);
    source = "production";
    project = serviceAccount.project_id;
    console.log(`reading PRODUCTION (project "${project}")`);
    initializeApp({ credential: cert(serviceAccount), projectId: project });
  }
  const db = getFirestore();

  const dump = {
    format: DUMP_FORMAT,
    name: config.name,
    project,
    source,
    exportedAt: new Date().toISOString(),
    collections: {},
  };
  for (const coll of await db.listCollections()) {
    process.stdout.write(`  dumping ${coll.id}...`);
    dump.collections[coll.id] = await dumpCollection(serialize, coll);
    process.stdout.write(` ${dump.collections[coll.id].length} docs\n`);
  }

  const backups = join(root, "backups");
  mkdirSync(backups, { recursive: true });
  const file = join(backups, dumpFileName(config.name, source));
  writeFileSync(file, JSON.stringify(dump, null, 2));
  console.log(`\nBackup written to ${file}`);
}

run(main);
