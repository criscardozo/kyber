# The consumer contract

kyber lives at `<consumer>/kyber/` as a git submodule. Everything that is
specific to one consumer lives in ONE file in the consumer:
`<consumer>/.kyber/config.json`. kyber's scripts read it; they never contain it.

## How the scripts find the consumer

Every script walks UP from its own location until it finds
`.kyber/config.json`, and fails with a message naming where it looked when
none exists. It never derives the root from `..` (one level too shallow once
the scripts moved into the submodule, and wrong without failing) and never from
`git rev-parse --show-toplevel` (which, inside a submodule, answers with
kyber's own root).

## Keys

Only the keys a script reads are validated, and unknown keys are ignored, so a
consumer can carry settings for a later batch before kyber reads them.

| key | type | read by | meaning |
| --- | --- | --- | --- |
| `name` | string | backup, restore, run-rules-tests | Short lowercase label. Names dump files (`<name>-<source>-<stamp>.json`) and temp dirs. |
| `projectId` | string | all | The production Firebase project. A service-account key for any other project is refused. |
| `emulatorProjectId` | string | backup, restore | The id `pnpm emulators` runs under. May equal `projectId` on purpose: rules whose `get()` must resolve in the real namespace need the real id. |
| `rulesTestsProjectId` | string | run-rules-tests | The id the rules suite runs the emulator under. |
| `firebaseDir` | path | all | Directory holding `firebase.json`, `firestore.rules`, `firestore.indexes.json` and the gitignored `service-account.json`. Relative to the consumer root. |
| `rulesTestsDir` | path | run-rules-tests | The rules-tests workspace: `firebase-tools` and `vitest` resolve from there, and `vitest run` runs there. |
| `restore.legacyIsoTimestamps` | boolean, optional | restore | `true` only for a consumer with real dumps from before the tagged format. Enables the legacy heuristic for dumps without a `format` field. Absent means the heuristic does not exist. |

`firebase.json` must declare `emulators.firestore.port`: the scripts take the
project's own port from there and never fall back to Firebase's default.

## Scripts

Wire them from the consumer's `package.json`:

```json
{
  "scripts": {
    "backup": "node kyber/scripts/backup.mjs",
    "restore": "node kyber/scripts/restore.mjs",
    "rules:drift": "node kyber/scripts/check-rules-drift.mjs"
  }
}
```

and, in the rules-tests workspace, `"test": "node ../../kyber/scripts/run-rules-tests.mjs"`
(the runner reads `rulesTestsDir` from the config, so it can be invoked from
anywhere in the consumer).

| script | reads | environment |
| --- | --- | --- |
| `backup.mjs` | name, projectId, emulatorProjectId, firebaseDir | `GOOGLE_APPLICATION_CREDENTIALS` for production; `FIRESTORE_EMULATOR_HOST` to read the emulator; `BACKUP_PROJECT_ID` to label an emulator dump. |
| `restore.mjs` | the same, plus `restore.*` | Emulator by default (the consumer's own port, or `FIRESTORE_EMULATOR_HOST`), only ever a local host. `--production` refuses a dump from another project, a dump not read from production, and a set `FIRESTORE_EMULATOR_HOST`; then asks for the project id typed. |
| `check-rules-drift.mjs` | projectId, firebaseDir | `GOOGLE_APPLICATION_CREDENTIALS`. Exit 1 when the deployed ruleset differs from `firestore.rules`. |
| `run-rules-tests.mjs` | name, rulesTestsProjectId, firebaseDir, rulesTestsDir | `FIRESTORE_EMULATOR_PORT` to pin a port (busy means stop, not move). |

## The dump format

```json
{
  "format": 1,
  "name": "<name>",
  "project": "<the project the connection was actually opened to>",
  "source": "production | emulator",
  "exportedAt": "<ISO>",
  "collections": { "<root>": [ { "id": "...", "data": { ... }, "collections": { ... } } ] }
}
```

Timestamps are tagged: `{ "$timestamp": "<ISO instant>" }`, alone in its
object. GeoPoint, DocumentReference and Bytes make the backup stop, naming the
document and the field. `source` and `project` describe the connection that
was opened, never an argument. The tag is a guard for the future, not a repair:
a dump written before the format is read exactly as it was written, and only
where the consumer has opted in (`restore.legacyIsoTimestamps`).

## The rules-tests helper must not opine

`@firebase/rules-unit-testing` prefers an explicit `host`/`port` in the
`initializeTestEnvironment` config over `FIRESTORE_EMULATOR_HOST`. The runner
starts the emulator on a free port and announces it through that variable, so
the consumer's helper passes only `projectId` and `rules`. A helper that also
passes a port makes the suite talk to whatever is on that port — a development
emulator, whose seed it then wipes, in green.

## Consuming kyber

```sh
git submodule add https://github.com/criscardozo/kyber.git kyber
git submodule update --init
```

The submodule URL is HTTPS and kyber is public, so cloning it needs no
credential anywhere: not on a developer's machine, not in CI, not on a deploy
platform.

That is deliberate. A **private** submodule is not deployable on Vercel, which
clones one only when it is publicly reachable over HTTP; a private one fails
with a single `Warning: Failed to fetch one or more git submodules` and the
build continues to a green deploy over an empty directory. Granting the Vercel
GitHub App access does not fix it — measured, with the App on *All
repositories*. kyber avoids the whole class by holding nothing worth hiding.

In GitHub Actions, one line is the whole story:

```yaml
- uses: actions/checkout@v7
  with:
    submodules: true
```

It checks out the commit the gitlink records. A private kyber would need a
read-only deploy key and a second checkout step, because the workflow token is
scoped to the consumer's own repository.
