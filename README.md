# kyber

What the household apps share, in one copy.

Three apps by the same author — the same house, the same stack (iOS with a
widget and a watch app, Firebase with emulators, a web app, GitHub Actions on
the free tier) — kept growing the same scripts and the same working rules in
parallel, and letting them drift. kyber is the part that is common. The filter
for getting in: it must be shared by the apps AND already earned in two of
them. Never product identity: no design tokens, no project id, no schema, no
Firestore rules.

## How it is consumed

As a git submodule at `<consumer>/kyber/`. One copy, never a synchronised one.

- Scripts are run from the consumer (`node kyber/scripts/backup.mjs`) and read
  `<consumer>/.kyber/config.json` for everything consumer-specific. The
  contract is in [docs/consumer-config.md](docs/consumer-config.md).
- Prose is imported from the consumer's `CLAUDE.md` with
  `@kyber/docs/<file>.md`. Each file is one working rule, named rather than
  numbered, so a consumer keeps its own numbering and its own deltas.
- `stack.json` declares the stack every consumer must agree with. It is read
  by each consumer's own `stack-agrees` test against its catalog,
  `packageManager`, workflows and `project.yml`; nothing in kyber reads it.

After cloning a consumer: `git submodule update --init`. `pnpm install` does
not do it.

## Adopting kyber in a new project

For whoever wires up the next consumer, human or agent. Do it in order — the
last step is how you find out it worked. The contract key by key is in
[docs/consumer-config.md](docs/consumer-config.md); this is the procedure.

1. **Add the submodule at the consumer's root, over HTTPS.**

   ```sh
   git submodule add https://github.com/criscardozo/kyber.git kyber
   ```

   HTTPS and not SSH: Vercel clones private submodules only over HTTPS, and on
   an SSH URL it warns and carries on — so the deploy stays green with the
   submodule missing, which is the failure you find out about last. If your own
   GitHub access is SSH-only, map it once and globally instead of changing the
   URL:

   ```sh
   git config --global url."git@github.com:".insteadOf "https://github.com/"
   ```

2. **Write `.kyber/config.json` at the consumer's root.** It is the ONLY place
   consumer-specific values live. Copy the shape and replace every value:

   ```json
   {
     "name": "<short lowercase label; names dump files and temp dirs>",
     "projectId": "<the production Firebase project>",
     "emulatorProjectId": "<the id the local emulator runs under>",
     "rulesTestsProjectId": "<the id the rules suite runs under>",
     "firebaseDir": "firebase",
     "rulesTestsDir": "firebase/rules-tests"
   }
   ```

   `emulatorProjectId` may legitimately equal `projectId`. Rules whose `get()`
   has to resolve in the real namespace read back empty under any other id, so
   a project in that shape runs its emulator under the production id on
   purpose — and then a rehearsal dump is indistinguishable from a real one by
   project alone, which is why every dump also records `source`.

   Add keys freely for things kyber does not read yet: only the keys a script
   needs are validated, and unknown ones are ignored.

3. **Declare the peers in the consumer.** kyber installs nothing. It needs
   `firebase-admin` for backup, restore and the drift check, and
   `firebase-tools` plus `vitest` reachable from the rules-tests workspace.
   Versions live in `stack.json`. A missing one is reported as a sentence
   naming who has to install it, not as a resolution trace.

4. **Give `firebase.json` an emulator port of your own.** It must declare
   `emulators.firestore.port`, and it should not be one of Firebase's
   defaults: the scripts refuse to guess rather than talk to whatever else is
   listening there.

5. **Wire the scripts in the consumer's `package.json`:**

   ```json
   {
     "scripts": {
       "backup": "node kyber/scripts/backup.mjs",
       "restore": "node kyber/scripts/restore.mjs",
       "rules:drift": "node kyber/scripts/check-rules-drift.mjs"
     }
   }
   ```

   and, in the rules-tests workspace,
   `"test": "node ../../kyber/scripts/run-rules-tests.mjs"`.

6. **Take the host and port out of the rules-test helper.**
   `@firebase/rules-unit-testing` prefers an explicit `host`/`port` over
   `FIRESTORE_EMULATOR_HOST`, and the runner announces the port it really
   started on through that variable. A helper that also passes a port sends the
   suite at whatever is on that port — a development emulator, whose seed it
   then wipes, in green. Pass `projectId` and `rules`, nothing else.

7. **Import the prose from the consumer's `CLAUDE.md`** with
   `@kyber/docs/<file>.md`, one line per rule adopted, keeping your own deltas
   beside it under the same heading. Never copy the text across: a second copy
   is a copy that drifts.

8. **Fetch the submodule in CI with a second checkout.** The default workflow
   token is scoped to the consumer alone, so it cannot read another private
   repository: `submodules: true` fails the whole step. A read-only deploy key
   of kyber (secret `KYBER_DEPLOY_KEY`) fetches it in a step of its own, with
   the ref taken from the gitlink so CI builds the exact commit the consumer
   recorded — and prints the sha it fetched:

   ```yaml
   - uses: actions/checkout@v7
   - id: kyber
     run: echo "sha=$(git rev-parse HEAD:kyber)" >> "$GITHUB_OUTPUT"
   - uses: actions/checkout@v7
     with:
       repository: criscardozo/kyber
       ref: ${{ steps.kyber.outputs.sha }}
       ssh-key: ${{ secrets.KYBER_DEPLOY_KEY }}
       path: kyber
   ```

   Two things this shape is deliberate about. `ssh-key:` goes on the SECOND
   checkout, never the first: on the first it makes the CONSUMER clone over
   SSH with that key, and a deploy key of kyber cannot clone the consumer (nor
   can one deploy key be registered on two repositories). And it is first-party
   only — the one step in a workflow that holds a credential is not the place
   to add a third-party action.

9. **Guard the boundary from your side.** kyber names no consumer, and it is
   the consumer that proves it: keep a list of your own needles — project ids,
   emulator ports, your app's proper name — and grep kyber's tree for them
   before taking a new commit. The list is your identity, so it lives with you,
   with no per-line exceptions.

10. **Verify, do not assume.** Each step either passes or says what is wrong:

    ```sh
    git submodule update --init     # what a fresh clone of the consumer must do
    pnpm test:rules                 # the runner starts an emulator on a free port
    FIRESTORE_EMULATOR_HOST=127.0.0.1:<your port> pnpm backup
    FIRESTORE_EMULATOR_HOST=127.0.0.1:<your port> pnpm restore backups/<the file it wrote>
    ```

    A backup nobody has read back is a hope, so the round trip is the real
    acceptance test: seed, back up, wipe, check the wipe left nothing, restore,
    compare. Make the comparison fail once on purpose before trusting one that
    passes.

### What belongs in kyber

- **In:** something these projects share AND that has already been earned in
  two of them. One project's good idea is not shared yet; it is a proposal.
- **Out:** anything that identifies a product — project ids, ports, schema,
  Firestore rules, design tokens, an app's own name. A script that needs one
  reads it from `.kyber/config.json`.
- Extract on the second occurrence, not the first, and bring the reasoning
  with the code. The comments explaining why a guard exists are most of what
  is being shared.

## Layout

```
kyber/
  README.md
  stack.json                 declared versions, one per shared tool
  docs/                      the rules that travel (Spanish, as written)
    publicar.md              nothing is published unless asked
    costo-cero.md            zero spend, no exceptions
    idiomas.md               languages
    firestore-free-tier.md   the free tier is part of the design
    codigo.md                code
    secretos.md              secrets
    versiones.md             what `major` means
    guardas.md               verify, do not assume; a guard is code too
    consumer-config.md       the consumer contract (English: it documents code)
  scripts/
    backup.mjs               Admin SDK dump to <consumer>/backups/
    restore.mjs              the dump back into the emulator or, guarded, production
    check-rules-drift.mjs    are the deployed rules the ones in the repo?
    run-rules-tests.mjs      the rules suite on a port that is actually free
    lib/                     consumer root and config, credentials, dump codec
  firebase/
    vitest-rules.mjs         the vitest settings every rules suite shares
  test/                      node --test, against a fixture consumer
```

kyber has no runtime dependencies. `firebase-admin`, `firebase-tools` and
`vitest` are peers: they resolve from the consumer's own `node_modules`
through Node's normal walk-up, and the scripts say so when one is missing.

## Working on kyber

```sh
pnpm check   # node --check on every script and test
pnpm test    # node --test, no install needed
```

Run the suite in BOTH layouts: a standalone clone and a checkout inside a
consumer. They are not the same environment, and a test that assumed the first
passed here while failing for a consumer that had just added the submodule.

Every guard in here was shown failing before it was trusted: the tests cover
`consumerRoot()` with no config above it, a dump without `format` for a
consumer that has not opted in, tags in a legacy dump, a `$timestamp` with
siblings, GeoPoint and Bytes in `serialize`, and a `"YYYY-MM-DD"` under a key
ending in `At` staying a string.

**kyber names no consumer**: not its project id, not its ports, not its
proper name. That holds for prose and comments as much as for code, and this
README is not exempt. Each consumer verifies it from its own side, with its own
list of needles — that list is the consumer's identity, not kyber's — and a
new kyber commit is taken only when that check prints nothing.

## Not yet in kyber

Noted for a second batch, once the consumers have converged on them:
`set-version.mjs` (reads `iosTargets` from the config), the pre-push hook, the
design-token emitter, `verify-pwa.mjs`, the iOS install script, and a
reusable backup workflow (which needs an explicit OK, per the Actions rule).
