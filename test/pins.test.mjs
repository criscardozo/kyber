import assert from "node:assert/strict";
import { test } from "node:test";
import { kyberPins, pinProblems } from "../scripts/lib/pins.mjs";

const SHA = "e7b8f51a1b2c3d4e5f60718293a4b5c6d7e8f901";
const OTHER = "0123456789abcdef0123456789abcdef01234567";

const workflow = (ref) => `name: Backup
on:
  schedule:
    - cron: "0 20 * * 3"
jobs:
  dump:
    uses: criscardozo/kyber/.github/workflows/backup.yml@${ref}
    secrets:
      FIREBASE_SERVICE_ACCOUNT: \${{ secrets.FIREBASE_SERVICE_ACCOUNT }}
`;

test("kyberPins finds the ref and the path it calls", () => {
  const pins = kyberPins(workflow(SHA));
  assert.deepEqual(pins, [{ path: ".github/workflows/backup.yml", ref: SHA }]);
});

test("kyberPins ignores calls to anything that is not kyber", () => {
  const text = "    uses: actions/checkout@v7\n    uses: pnpm/action-setup@v6\n";
  assert.deepEqual(kyberPins(text), []);
});

test("a pin matching the gitlink is fine", () => {
  assert.deepEqual(pinProblems(kyberPins(workflow(SHA)), SHA), []);
});

test("a pin on a different commit is caught, and both are named", () => {
  const problems = pinProblems(kyberPins(workflow(OTHER)), SHA);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /0123456 but the submodule is at e7b8f51/);
});

test("a branch or tag is refused, not compared", () => {
  // @main silently changes what runs when kyber changes, which is the
  // opposite of what pinning by gitlink is for. A tag has the same problem:
  // a tag can be moved.
  for (const ref of ["main", "v1.0.0", "e7b8f51"]) {
    const problems = pinProblems(kyberPins(workflow(ref)), SHA);
    assert.equal(problems.length, 1, `${ref} was not refused`);
    assert.match(problems[0], /not a full commit sha/);
  }
});

test("the file name is carried into the message when there is one", () => {
  const pins = kyberPins(workflow(OTHER)).map((p) => ({ ...p, file: "backup.yml" }));
  assert.match(pinProblems(pins, SHA)[0], /^backup\.yml \(\.github\/workflows\/backup\.yml\)/);
});

test("several workflows are all reported, not just the first", () => {
  const pins = [
    ...kyberPins(workflow(OTHER)).map((p) => ({ ...p, file: "backup.yml" })),
    ...kyberPins(workflow("main")).map((p) => ({ ...p, file: "ci.yml" })),
  ];
  const problems = pinProblems(pins, SHA);
  assert.equal(problems.length, 2);
  assert.match(problems.join("\n"), /backup\.yml/);
  assert.match(problems.join("\n"), /ci\.yml/);
});
