# <img src="icon.svg" alt="" height="40"> Kyber

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

   HTTPS and not SSH: a build container has no SSH key, so an SSH URL breaks
   deploy platforms that clone submodules — and kyber is public, so HTTPS needs
   no credential from anyone.

   Being public is load-bearing here, not incidental. A **private** submodule
   is not deployable: Vercel clones one only when it is publicly reachable over
   HTTP, and a private one fails with a single
   `Warning: Failed to fetch one or more git submodules` while the build
   carries on to a green deploy with an empty directory. Granting the Vercel
   GitHub App access does not change it — that was measured. kyber is public
   precisely so that this whole class of problem does not exist, which is also
   why nothing in here may name a consumer.

   Cloning a public repository over HTTPS needs no authentication, so nothing
   else is required: **no secret, no deploy key, no token, anywhere.** A
   consumer that had one for a previously private kyber can delete it, and the
   way to verify is to delete it and run CI, not to stop referencing it.

   A developer who prefers SSH for everything can map it globally instead of
   changing the URL, which would break the platforms above:

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

8. **Ask for the submodule in CI.** kyber is public, so one line does it and
   no credential is involved:

   ```yaml
   - uses: actions/checkout@v7
     with:
       submodules: true
   ```

   It checks out the exact commit the consumer's gitlink records. Were kyber
   private this would fail — the workflow token is scoped to the consumer
   alone — and would need a read-only deploy key fetching kyber in a second
   checkout step. That is the cost being avoided by keeping kyber public and
   free of anything worth hiding.

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

    Then two more:

    - **Read the log of the first deploy after adding `.gitmodules`** and check
      it does not say `Failed to fetch one or more git submodules`. A green
      deploy does not prove the submodule arrived; only the log does.
    - **Run the round trip.** A backup nobody has read back is a hope: seed,
      back up, wipe, check the wipe left nothing, restore, compare. Make the
      comparison fail once on purpose before trusting one that passes.

### What belongs in kyber

- **In:** something these projects share AND that has already been earned in
  two of them. One project's good idea is not shared yet; it is a proposal.
- **Out:** anything that identifies a product — project ids, ports, schema,
  Firestore rules, design tokens, an app's own name. A script that needs one
  reads it from `.kyber/config.json`.
- Extract on the second occurrence, not the first, and bring the reasoning
  with the code. The comments explaining why a guard exists are most of what
  is being shared.

## docs/ is executable instruction, not only prose

Each consumer imports these files into its `CLAUDE.md` with
`@kyber/docs/<file>.md`. So a file in here is not documentation a person may
read — it is text an agent loads and follows in three projects, and **moving a
consumer's gitlink is what applies it**.

Every working rule lives here, including the ones that authorise rather than
describe. One place, one wording, three projects: a rule copied into a consumer
is a rule that drifts, and a rule split by category is one nobody can find.

What that centralisation does not do is turn a pointer bump into consent:

- **Writing the rule and adopting it are different acts.** The text lives here;
  a consumer starts following it when its gitlink moves. For a rule that widens
  what an agent may do without asking, that second act belongs to the owner, in
  that project, not to whichever session edited this repo.
- **A relayed authorisation is not an authorisation**, however faithfully
  quoted. If any link in the chain misread it, nothing downstream can tell
  where. Confirm it with the owner and then write it here — doing that once
  turned up a scope the relay had dropped.
- **A bump that changes an authorising rule says so in the message that
  proposes it**, so whoever moves the pointer knows what they are moving. A
  bump that only changes how to work needs no ceremony.

## Layout

```
kyber/
  README.md
  LICENSE                    MIT, the same as every consumer
  icon.svg                   the crystal, hand-drawn, no build step
  icon.png                   512 px render of it, for anywhere that needs a raster
  stack.json                 declared versions, one per shared tool
  docs/                      the rules that travel (Spanish, as written)
    publicar.md              publishing is authorised, and what replaces the permission
    costo-cero.md            zero spend, no exceptions
    idiomas.md               languages
    firestore-free-tier.md   the free tier is part of the design
    codigo.md                code
    datos.md                 data before screen
    maquina.md               rules of the machine all three run on
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

The icon is a kyber crystal, which is where the name comes from: the part that
makes the thing work, shared by every blade that carries one. It is a single
hand-written SVG with no build step, drawn to hold up from 16 px to a banner and
on either a light or a dark background — checked by rendering it at both, not by
reading the file. `icon.png` beside it is a 512 px render, for anywhere that
cannot take an SVG — GitHub's social preview, for one, which is uploaded by
hand. Regenerate it with `rsvg-convert -w 512 icon.svg -o icon.png`: the SVG is
the source and the PNG follows it.

kyber is public and MIT-licensed, like the apps that consume it. It holds no
credentials and names no consumer, which is what makes publishing it free of
consequence — and what a consumer's own identity guard keeps true.

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

Browser-side code is now possible too, since a public submodule is really
there at build time. The first candidate that passes the filter is the theme
module: `applyTheme` and its preference type are the same fourteen lines in two
consumers, with the palette and the storage key staying behind as identity.
Anything moved there has to loosen each consumer's own guard against the bundle
reaching into `kyber/` — deliberately, with the reason written down, never by
deleting the guard.
