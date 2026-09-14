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

Every guard in here was shown failing before it was trusted: the tests cover
`consumerRoot()` with no config above it (including running kyber on its
own), a dump without `format` for a consumer that has not opted in, tags in a
legacy dump, a `$timestamp` with siblings, GeoPoint and Bytes in `serialize`,
and a `"YYYY-MM-DD"` under a key ending in `At` staying a string.

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
