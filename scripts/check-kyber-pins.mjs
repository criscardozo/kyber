#!/usr/bin/env node
// Do the consumer's workflows call the same kyber commit its submodule is on?
//
// Run it from the consumer, in CI or a hook:
//   node kyber/scripts/check-kyber-pins.mjs

import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { consumerRoot } from "./lib/consumer.mjs";
import { KyberError, run } from "./lib/errors.mjs";
import { gitlinkFromIndex, kyberPins, pinProblems } from "./lib/pins.mjs";

async function main() {
  const root = consumerRoot();
  const dir = join(root, ".github", "workflows");

  let files;
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
  } catch {
    console.log("No .github/workflows to check.");
    return;
  }

  let gitlink;
  try {
    const out = execFileSync("git", ["ls-files", "-s", "kyber"], { cwd: root, encoding: "utf8" });
    gitlink = gitlinkFromIndex(out);
  } catch {
    gitlink = null;
  }
  if (gitlink === null) {
    throw new KyberError(
      "Cannot read the submodule gitlink (`git ls-files -s kyber`).\n" +
        "  Is kyber added as a submodule at ./kyber?",
    );
  }

  // Informative, never fatal: the submodule can sit on a commit that is not
  // the one about to be committed, and then what runs locally is not what CI
  // will run. Saying so is useful; failing on it would be a second false
  // positive in the place the first one was.
  try {
    const here = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: join(root, "kyber"), encoding: "utf8",
    }).trim();
    if (here !== gitlink) {
      console.log(
        `note: kyber/ is checked out at ${here.slice(0, 7)} but the index says ` +
          `${gitlink.slice(0, 7)}. Locally you are running the first one.`,
      );
    }
  } catch {
    // No submodule checkout to compare against; the pins are still checkable.
  }

  const pins = files.flatMap((file) =>
    kyberPins(readFileSync(join(dir, file), "utf8")).map((pin) => ({ ...pin, file })),
  );
  // Nothing found is reported, not passed over: a workflow that stopped
  // calling kyber and a regex that stopped matching look identical from here.
  if (pins.length === 0) {
    console.log(`No workflow calls kyber. Checked ${files.length} file(s) in .github/workflows.`);
    return;
  }

  const problems = pinProblems(pins, gitlink);
  if (problems.length > 0) {
    throw new KyberError(
      "A workflow calls a different kyber commit than the submodule is on:\n" +
        problems.map((p) => `  - ${p}`).join("\n") +
        `\n  Point both at ${gitlink}, in the same commit.`,
    );
  }
  console.log(`${pins.length} kyber pin(s) agree with the submodule at ${gitlink.slice(0, 7)}.`);
}

run(main);
