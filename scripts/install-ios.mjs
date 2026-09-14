#!/usr/bin/env node
// Build, re-sign and install on the phone — the whole procedure, so that none
// of it depends on remembering.
//
// Installing ALWAYS renews the signature. A free team reuses whatever
// provisioning profile already exists, so an ordinary build keeps the old
// expiry and reinstalling buys nothing: every install spends days off the same
// profile until the app stops opening. One install left an app 23 hours from
// dying, and reinstalling could not save it. It is not a decision to make by
// looking at how long is left — looking is exactly what leads to skipping it.
//
// The guards, each earned in both projects independently:
//
//   1. The build's status is captured BEFORE anything is piped. `xcodebuild |
//      grep` returns GREP's exit code — measured: 0 for a build that failed
//      with 65. Reading "BUILD SUCCEEDED" out of the text works only because
//      xcodebuild happens to print it.
//   2. Nothing is read out of the bundle until the build is known to have
//      succeeded. When it fails, the .app on disk is still the PREVIOUS one,
//      so its old dates read as "it did not renew" when the truth is "nothing
//      was issued".
//   3. The profiles go back when the build FAILS, and only then. After a
//      success Xcode has already issued replacements under new filenames, so
//      putting the old ones back restores nothing and piles up a dead set
//      every run. Measured in a consumer: 12 profiles became 16 in two runs.
//   4. It aborts when the freshly issued signature has under a day left, which
//      is precisely what a silent non-renewal looks like from here.
//   5. It compares what the built bundle will SHOW against what the project
//      declares. The version guard reads the tracked files, and those hold
//      `$(MARKETING_VERSION)`; only the bundle has the substituted value.
//
// And every exit says WHICH STAGE it died at. A negative result has to say
// where, not just that: one of these scripts once failed its own failure-test
// at the first stage and still printed a plausible "non-zero exit, profiles
// restored" for a build that had never run.
//
// Usage:  node kyber/scripts/install-ios.mjs [--device <udid-or-name>]
// Reads from .kyber/config.json: bundleId, iosScheme, and optionally iosDir,
// iosDevice and webManifest.

import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { loadConsumer } from "./lib/consumer.mjs";
import { KyberError, run } from "./lib/errors.mjs";
import { belongsToApp, signingVerdict, versionVerdict } from "./lib/signing.mjs";

const PROFILES = join(
  process.env.HOME ?? "",
  "Library/Developer/Xcode/UserData/Provisioning Profiles",
);

let stage = "arranque";
const say = (text) => {
  stage = text;
  console.log(`\n== ${text} ==`);
};

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: "utf8", ...opts });

/** The decoded plist of a .mobileprovision, or null when it cannot be read. */
function readProfile(path) {
  try {
    const xml = sh("security", ["cms", "-D", "-i", path], { maxBuffer: 8 << 20 });
    const get = (key) =>
      sh("plutil", ["-extract", key, "raw", "-o", "-", "-"], { input: xml }).trim();
    return {
      name: get("Name"),
      appId: get("Entitlements.application-identifier"),
      expiry: new Date(get("ExpirationDate")),
    };
  } catch {
    return null;
  }
}

async function main() {
  const { root, config, dir } = loadConsumer({ required: ["bundleId", "iosScheme"] });
  const iosDir = config.iosDir ? dir("iosDir") : join(root, "apps", "ios");
  const manifest = config.webManifest
    ? dir("webManifest")
    : join(root, "apps", "web", "package.json");

  const argv = process.argv.slice(2);
  const flag = argv.indexOf("--device");
  const device = flag !== -1 ? argv[flag + 1] : (process.env.IOS_DEVICE ?? config.iosDevice);
  if (device === undefined || device === "") {
    throw new KyberError(
      "No device. Pass --device <udid or name>, set IOS_DEVICE, or put\n" +
        '  "iosDevice" in .kyber/config.json.',
    );
  }

  const project = join(iosDir, `${config.iosScheme}.xcodeproj`);
  if (!existsSync(project)) {
    throw new KyberError(`No ${basename(project)} in ${iosDir}. Run xcodegen first.`);
  }

  const stash = mkdtempSync(join(tmpdir(), "kyber-profiles-"));
  const derived = mkdtempSync(join(tmpdir(), "kyber-dd-"));
  let renewed = false;

  const restoreProfiles = () => {
    // Guard 3: only on failure, and only what is actually missing.
    if (renewed) return;
    const held = readdirSync(stash).filter((f) => f.endsWith(".mobileprovision"));
    for (const file of held) {
      const back = join(PROFILES, file);
      if (!existsSync(back)) copyFileSync(join(stash, file), back);
    }
    if (held.length > 0) console.log("   (perfiles restaurados: no se emitió ninguno nuevo)");
  };

  try {
    say(`1. Apartando los perfiles de ${config.bundleId}`);
    let moved = 0;
    for (const file of readdirSync(PROFILES).filter((f) => f.endsWith(".mobileprovision"))) {
      const profile = readProfile(join(PROFILES, file));
      if (profile === null || !belongsToApp(profile.appId, config.bundleId)) continue;
      copyFileSync(join(PROFILES, file), join(stash, file));
      rmSync(join(PROFILES, file));
      console.log(`   ${profile.name}`);
      moved += 1;
    }
    console.log(`   ${moved} apartados (se reemiten en la misma pasada, así quedan alineados)`);

    say(`2. Compilando ${config.iosScheme}`);
    // Guard 1: the status first, and only then the log. Nothing is piped here.
    const log = join(derived, "build.log");
    let status = 0;
    try {
      const out = sh(
        "xcodebuild",
        [
          "build",
          "-project", project,
          "-scheme", config.iosScheme,
          "-configuration", "Debug",
          "-destination", "generic/platform=iOS",
          "-derivedDataPath", derived,
          "-allowProvisioningUpdates",
        ],
        { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 },
      );
      writeFileSync(log, out);
    } catch (error) {
      status = error.status ?? 1;
      writeFileSync(log, `${error.stdout ?? ""}${error.stderr ?? ""}`);
    }

    if (status !== 0) {
      const text = readFileSync(log, "utf8");
      console.log(`   el build falló (${status}):`);
      for (const line of text.split("\n").filter((l) => l.includes("error:")).slice(0, 5)) {
        console.log(`     ${line.trim()}`);
      }
      // "No Accounts" is xcodebuild's own message and it is misleading. Xcode
      // HAS the account; what it could not do is load the account's
      // credential, and it then PRUNES the account it could not authenticate
      // — so the empty account list is the consequence, not the cause.
      //
      // Read from the LOG and not from the keychain: Xcode keeps that
      // credential in the data-protection keychain, which the `security` CLI
      // cannot enumerate at all, so a pre-flight check there fails even with
      // signing working perfectly.
      if (/missing Xcode-Username|No Accounts/.test(text)) {
        console.log(
          "\n   La cuenta está en Xcode pero se perdió su credencial del keychain,\n" +
            "   así que xcodebuild no puede pedir un perfil nuevo. Se arregla\n" +
            "   volviendo a firmar: Xcode -> Settings -> Accounts -> Sign In,\n" +
            "   y corriendo esto otra vez.",
        );
      }
      throw new KyberError(`   el build terminó en ${status}.`);
    }
    console.log("   BUILD SUCCEEDED (exit 0, no leído del texto)");
    // Past here the old profiles are superseded, not worth putting back.
    renewed = true;

    // Guard 2: reached only with status 0, so the bundle is this build's.
    say("3. Firma emitida");
    const app = join(derived, "Build/Products/Debug-iphoneos", `${config.iosScheme}.app`);
    const embedded = sh("find", [app, "-name", "embedded.mobileprovision"])
      .trim()
      .split("\n")
      .filter(Boolean);
    const profiles = embedded
      .map((path) => readProfile(path))
      .filter((p) => p !== null)
      .map((p) => ({ name: p.name, expiry: p.expiry }));
    const verdict = signingVerdict(profiles);
    for (const p of verdict.sorted) {
      console.log(`   ${p.name.padEnd(52)} vence ${p.expiry.toISOString()}`);
    }
    console.log(`   el más corto manda: quedan ${verdict.days} días y ${verdict.hours} horas`);
    // Guard 4.
    if (!verdict.fresh) {
      throw new KyberError(
        `   ABORTO: una firma recién emitida dura 7 días, no ${verdict.days}d ${verdict.hours}h.\n` +
          "   No se reemitió nada. No instalo para no dejarte una app que muere hoy.",
      );
    }

    // Guard 5.
    say("4. La versión que se vería en Ajustes");
    const declared = JSON.parse(readFileSync(manifest, "utf8")).version;
    let shipped = "(sin clave)";
    try {
      shipped = sh("plutil", [
        "-extract", "CFBundleShortVersionString", "raw", join(app, "Info.plist"),
      ]).trim();
    } catch {
      // Left as the placeholder, which cannot agree with a real version.
    }
    const version = versionVerdict(shipped, declared);
    console.log(`   la app declara ${version.shipped} · el manifiesto dice ${version.declared}`);
    if (!version.agrees) {
      throw new KyberError(
        `   ABORTO: lo que se instalaría muestra ${version.shipped}, no ${version.declared}.\n` +
          "   Revisá CFBundleShortVersionString en project.yml y corré xcodegen.",
      );
    }

    say(`5. Instalando en ${device}`);
    // The phone sometimes answers "disconnected immediately after connecting"
    // on the first try and is fine on the second.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const out = sh("xcrun", [
          "devicectl", "device", "install", "app", "--device", device, app,
        ]);
        const line = out.split("\n").find((l) => l.includes("bundleID"));
        console.log(`   ${line === undefined ? "instalado" : line.trim()}`);
        // Named for the same reason as the app: an extension that failed to
        // embed installs a perfectly working app with no widget, and nothing
        // else says so.
        for (const extra of ["Watch", "PlugIns"]) {
          const path = join(app, extra);
          const what = existsSync(path) ? readdirSync(path).join(" ") : "no embebido";
          console.log(`   ${extra.toLowerCase().padEnd(7)} ${what}`);
        }
        say(`Listo. Vence en ${verdict.days} días.`);
        return;
      } catch (error) {
        if (attempt === 3) {
          throw new KyberError(
            `   no pude instalar: ${String(error.stderr ?? error.message).slice(0, 200)}`,
          );
        }
        console.log(`   intento ${attempt} falló, reintento en 20s`);
        execFileSync("sleep", ["20"]);
      }
    }
  } catch (error) {
    // Where, not just whether: without this, dying before the build looks
    // exactly like a build that failed.
    console.error(`\nFALLÓ en: ${stage}`);
    throw error;
  } finally {
    restoreProfiles();
    rmSync(stash, { recursive: true, force: true });
  }
}

run(main);
