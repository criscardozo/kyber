// Executables of packages the CONSUMER installed, found from where the consumer
// installed them.
//
// kyber has no node_modules of its own. `firebase` and `vitest` resolve today
// because both consumers declare them; a script that shells out to a bare name
// works only while pnpm has put a `.bin` on the PATH, and nothing says which
// one. Resolving through the package's own manifest gives the same binary
// however the script was started.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { KyberError } from "./errors.mjs";

/**
 * Absolute path of `binName` as declared by `packageName`'s `bin` field,
 * resolved as if required from `fromDir`.
 */
export function resolveBin(fromDir, packageName, binName) {
  const require = createRequire(join(fromDir, "package.json"));
  let manifestPath;
  try {
    manifestPath = require.resolve(`${packageName}/package.json`);
  } catch {
    throw new KyberError(
      `Cannot find "${packageName}" from ${fromDir}.\n` +
        `  kyber does not install it; the consumer must declare it ` +
        `(see peerDependencies in kyber/package.json).`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const bin =
    typeof manifest.bin === "string" ? manifest.bin : manifest.bin?.[binName];
  if (typeof bin !== "string") {
    throw new KyberError(`"${packageName}" declares no "${binName}" executable.`);
  }
  return join(dirname(manifestPath), bin);
}

/**
 * Import a module the CONSUMER installed, resolved from `fromDir`.
 *
 * Same reason as resolveBin: kyber has no node_modules, so a bare specifier
 * would resolve by accident of where the process started, or not at all.
 */
export async function importFrom(fromDir, specifier) {
  const require = createRequire(join(fromDir, "package.json"));
  let resolved;
  try {
    resolved = require.resolve(specifier);
  } catch {
    throw new KyberError(
      `Cannot find "${specifier}" from ${fromDir}.\n` +
        "  kyber does not install it; the consumer's own workspace must declare it.",
    );
  }
  return import(pathToFileURL(resolved).href);
}
