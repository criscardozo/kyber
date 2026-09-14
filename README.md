<p align="center">
  <img src="banner.png" alt="Kyber" width="360">
</p>

The shared layer for three household apps by the same author, on the same stack
— SwiftUI on iOS with a widget and a watch app, Next.js on the web, Firebase on
the Spark free tier, GitHub Actions on Linux only — which kept growing the same
scripts and the same working rules in parallel and letting them drift. Consumed
as a git submodule: one copy, never a synchronised one. Two rules decide what
gets in, and between them they explain every choice below: it has to be
**earned in two** of the apps, and it may **never carry product identity**.

| | |
|---|---|
| 📜 Rules | `docs/` — the working rules that travel, in Spanish as written. Each consumer imports them into its `CLAUDE.md`, so these are instruction, not only prose |
| ⚙️ Tooling | `scripts/` — Firestore backup and restore, the deployed-rules drift check, a rules-test runner that finds a free port, the version bump across web and iOS, the offline PWA check, the build-sign-install run for the phone, and the guard that keeps a consumer's two pointers at kyber in step. Each reads the consumer's own `.kyber/config.json` |
| 🔁 Workflow | `.github/workflows/backup.yml` — the weekly Firestore dump as a reusable workflow. The consumer keeps the schedule and calls it; the minutes are the caller's |
| 🔥 Firebase | `firebase/` — the vitest settings every consumer's rules suite shares |
| 📌 Stack | `stack.json` — one declared version per shared tool. Each consumer's own test makes it binding; nothing here reads it |
| 🧪 Tests | `test/` — `node --test` against a fixture consumer, no install needed |
| 💎 Mark | `icon.svg` — the crystal, hand-drawn. `icon.png` renders it; `banner.png` is built from it by `design/build-banner.mjs` |

## What it does

Holds the parts three sibling projects were each maintaining a copy of. The
scripts run **from** the consumer and read `<consumer>/.kyber/config.json` for
everything specific to it, so the same `backup.mjs` serves a project it has
never heard of. The prose is imported with `@kyber/docs/<file>.md`, one file per
rule, named rather than numbered, so each consumer keeps its own numbering and
its own deltas beside the shared text.

What it deliberately does not do: it **names no consumer** — no project id, no
port, no schema, no Firestore rules, no design tokens, not even an app's proper
name; anything a script needs of that kind it is handed. It **installs
nothing** — `firebase-admin`, `firebase-tools` and `vitest` are peers resolved
from the consumer's own `node_modules`, and a missing one is reported as a
sentence naming who installs it rather than a resolution trace. And it **has no
version of its own**: consumers pin the exact commit through the submodule
gitlink, so there is nothing here to tag or release.

## Quick start

```sh
git submodule add https://github.com/criscardozo/kyber.git kyber
git submodule update --init        # `pnpm install` does NOT do this

# then, in the consumer: .kyber/config.json, and scripts wired to kyber/scripts/
node kyber/scripts/backup.mjs      # dump to <consumer>/backups/
node kyber/scripts/restore.mjs backups/<file>.json
node kyber/scripts/check-rules-drift.mjs

# working on kyber itself:
pnpm check                         # node --check on every script and test
pnpm test                          # node --test, nothing to install
```

The full wiring, step by step, is [below](#adopting-it-in-a-new-project); the
contract key by key is in [docs/consumer-config.md](docs/consumer-config.md).

## Adopting it in a new project

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

## Key invariants

- **Earned in two, or it does not come in.** One project's good idea is not
  shared yet; it is a proposal. Extract on the second occurrence, and bring the
  reasoning with the code — the comments explaining why a guard exists are most
  of what is being shared.
- **Earned in two is necessary and it is not sufficient.** What has to clear
  the bar is the EXTRACTION, not the duplication: a config entry, an import
  path, a guard somebody has to loosen, a second place to look when it breaks.
  Fourteen identical lines do not pay for that. Neither do three
  implementations of one idea that share no code — then what travels is the
  practice, written down, and the implementations stay where they are.
- **Nothing here names a consumer.** Not in code, not in comments, not in prose,
  and this README is not exempt. Each consumer verifies it from its own side
  with its own list of needles, because that list is the consumer's identity;
  a new commit is taken only when that check prints nothing.
- **The consumer root is found by walking up to `.kyber/config.json`** — never
  from `..`, which is one level off once the scripts live in a submodule and is
  wrong without failing, and never from `git rev-parse --show-toplevel`, which
  inside a submodule answers with kyber's own root.
- **A dump is read back before it is trusted.** Timestamps are tagged rather
  than flattened, because the flattened form makes a round trip that compares
  equal while every audit field has changed type.
- **kyber stays public.** A private submodule is not deployable — the platform
  clones it only over public HTTP and a green deploy can hide an empty
  directory — and it holds no credentials and names nobody, so there is nothing
  publishing it could cost.

## Working on kyber

```sh
git config core.hooksPath .githooks   # once per clone
```

The hook runs `node --check` over every script and the whole suite before each
push. It exists because running them by hand worked right up until the commit
whose message described an edit that had failed its own assertion: the check
had happened, it was simply not what the push depended on. Both finish in
under a second, measured — the usual reason for keeping tests out of a hook is
a guess about how long they take.

It deliberately does NOT grep for consumer names. The first version did, and
rejected the commit installing it: to grep for a consumer's ids and ports the
hook had to contain them, and this repo may not. That check is each
consumer's, with its own list.

Run the suite in BOTH layouts: a standalone clone and a checkout inside a
consumer. They are not the same environment, and a test that assumed the first
passed here while failing for a consumer that had just added the submodule.

Every guard in here was shown failing before it was trusted: the tests cover
`consumerRoot()` with no config above it, a dump without `format` for a
consumer that has not opted in, tags in a legacy dump, a `$timestamp` with
siblings, GeoPoint and Bytes in `serialize`, and a `"YYYY-MM-DD"` under a key
ending in `At` staying a string.

The mark is a kyber crystal, which is where the name comes from: the part that
makes the thing work, shared by every blade that carries one. `icon.svg` is
hand-written with no build step, drawn to hold up from 16 px upward on either a
light or a dark background — checked by rendering it at both, not by reading
the file.

Everything else derives from it, and by script rather than by hand, because a
second drawing of the same mark is one nothing keeps in step:

```sh
node design/build-banner.mjs                 # banner.png, what the README opens with
rsvg-convert -w 512 icon.svg -o icon.png     # icon.png, for GitHub's social preview
```

## Not yet in kyber

Measured against the filter rather than assumed, because two of these turned
out not to qualify for reasons nobody had guessed:

- **The iOS install script is in.** Both consumers had one, with the same
  guards found separately.
- **The banner generator does not extract, measured.** Three implementations
  of one problem and **not a single shared line of code**: they differ in what
  the mark IS (a drawing function, a shipped PNG, an SVG) and in what they emit
  (an SVG with the word as paths and three variants, or one PNG). What they
  genuinely share is the procedure and its five traps, and that is already
  extracted — into `docs/readmes.md`, as rules. Sharing the code would mean
  rewriting the richest of the three to fit a signature that suits neither of
  the others well. The practice travelled; the implementation should not.
- **The theme module passes the filter and is still not worth it**, which is
  what put the second clause of the filter into words. It goes in when
  something bigger goes with it.
- **The design-token emitter does not, and not because one side lacks it.**
  The two projects solved the same problem in opposite directions: one
  generates the stylesheet and the Swift theme from a token file and proves it
  in CI with a diff, the other writes the palette twice and has a test
  comparing the copies. There is no intersection to extract — a strategy has to
  be chosen first, and generating is the stronger one (see `docs/guardas.md`).
  That is a migration in a consumer, so it is Cristian's call, not this repo's.
- **The reusable backup workflow is in**, approved. It was byte-identical in
  both consumers apart from two sentences of comment.

The **pre-push hook** is not here and does not qualify yet: only one consumer
has one at all — no `.githooks`, no husky and no `core.hooksPath` in the other
— so it is earned in one. The version bump and the PWA check came in once both
had them.

Browser-side code is now possible too, since a public submodule is really
there at build time. The first candidate that passes the filter is the theme
module: `applyTheme` and its preference type are the same fourteen lines in two
consumers, with the palette and the storage key staying behind as identity.
Anything moved there has to loosen each consumer's own guard against the bundle
reaching into `kyber/` — deliberately, with the reason written down, never by
deleting the guard.

## License

[MIT](LICENSE)
